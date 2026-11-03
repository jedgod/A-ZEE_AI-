"""Unit and API tests use mocked providers and don't download NLP models.
The database isolation test runs against a real PostgreSQL with pgvector (Compose), else it skips."""
import os

os.environ.setdefault("API_TOKEN", "unit-test-token")
os.environ.setdefault("OPENAI_API_KEY", "unit-test-key")

import asyncio  # noqa: E402
import json  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.context import ContextService, compact  # noqa: E402
from app.main import app  # noqa: E402
from app.preprocess import LANGUAGE_MIN_CHARS, Preprocessor, normalize  # noqa: E402
from app.settings import Settings  # noqa: E402

AUTH = {"Authorization": "Bearer unit-test-token"}


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def bare_preprocessor(**overrides):
    """A Preprocessor without spaCy/Presidio models, for testing the async control flow."""
    pre = object.__new__(Preprocessor)
    pre.lock = asyncio.Lock()
    pre.local = lambda text: {"text": text, "language": "en"}
    pre.key = "test"
    pre.client = AsyncMock()
    for name, value in overrides.items():
        setattr(pre, name, value)
    return pre


def test_normalization_preserves_structure():
    assert normalize("  Hello\nWorld\tX\x00 ") == "Hello\nWorld\tX"


def test_compaction_is_valid_and_bounded():
    result = compact([{"content": "a" * 2000}, {"content": "short"}], 30)
    assert result["tokens"] <= 30
    assert json.loads(result["text"]) == [{"content": "short"}]
    assert result["omitted"] == 1


async def test_authentication_required():
    async with client() as c:
        response = await c.post("/v1/02/preprocess", json={"text": "Hello"})
    assert response.status_code == 401


async def test_preprocess_endpoint_does_not_return_raw_pii():
    app.state.pre = AsyncMock()
    app.state.pre.run.return_value = {
        "text": "Contact <EMAIL_ADDRESS>", "language": "en", "confidence": 0.99,
        "redacted_types": ["EMAIL_ADDRESS"], "safety_passed": True,
    }
    async with client() as c:
        r = await c.post("/v1/02/preprocess", headers=AUTH, json={"text": "Contact alice@example.com"})
    assert r.status_code == 200
    assert "alice@example.com" not in r.text


async def test_moderation_failure_is_closed():
    pre = bare_preprocessor()
    pre.client.post.side_effect = httpx.ConnectError("unavailable")
    with pytest.raises(HTTPException) as error:
        await pre.run("Hello")
    assert error.value.status_code == 503


async def test_moderation_blocks_flagged_content():
    pre = bare_preprocessor()
    pre.client.post.return_value = httpx.Response(
        200, json={"results": [{"flagged": True}]}, request=httpx.Request("POST", "https://test"))
    with pytest.raises(HTTPException) as error:
        await pre.run("Rejected fixture")
    assert error.value.status_code == 422


class FakeIdentifier:
    def __init__(self, language, confidence):
        self.result = (language, confidence)

    def classify(self, text):
        return self.result


class FakeAnalyzer:
    def analyze(self, text, language):
        assert language == "en"
        return []


class FakeAnonymizer:
    def anonymize(self, text, analyzer_results):
        return type("Result", (), {"text": text})()


def local_preprocessor(language, confidence):
    return bare_preprocessor(identifier=FakeIdentifier(language, confidence), analyzer=FakeAnalyzer(),
                             anonymizer=FakeAnonymizer(), local=None)


def test_short_or_uncertain_text_is_analyzed_as_english():
    # Titles and tool names like "search" are often misclassified; they must not be rejected.
    pre = local_preprocessor("it", 0.99)
    assert Preprocessor.local(pre, "search")["language"] == "en"
    long_but_uncertain = local_preprocessor("fr", 0.5)
    assert Preprocessor.local(long_but_uncertain, "x" * LANGUAGE_MIN_CHARS)["language"] == "en"


def test_long_confident_non_english_fails_closed():
    pre = local_preprocessor("de", 0.99)
    with pytest.raises(HTTPException) as error:
        Preprocessor.local(pre, "Das ist ein ziemlich langer deutscher Satz über Datenschutz.")
    assert error.value.status_code == 422


def test_provider_keys_fall_back_to_openai_key():
    cfg = Settings(api_token="t", openai_api_key="openai", embedding_api_key="gemini")
    assert cfg.key_for("embedding") == "gemini"
    assert cfg.key_for("chat") == "openai"


async def test_embeddings_use_the_configured_openai_compatible_endpoint():
    cfg = Settings(api_token="t", openai_api_key="openai", embedding_api_key="gemini",
                   embedding_api_base="https://generativelanguage.googleapis.com/v1beta/openai/",
                   embedding_model="gemini-embedding-001", embedding_dimensions=3)
    http = AsyncMock()
    http.post.return_value = httpx.Response(
        200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]}, request=httpx.Request("POST", "https://test"))
    assert await ContextService(http, cfg).embed("hello") == [0.1, 0.2, 0.3]
    url = http.post.call_args.args[0]
    assert url == "https://generativelanguage.googleapis.com/v1beta/openai/embeddings"
    assert http.post.call_args.kwargs["headers"]["Authorization"] == "Bearer gemini"
    assert http.post.call_args.kwargs["json"]["model"] == "gemini-embedding-001"


async def test_embedding_dimension_mismatch_is_rejected():
    cfg = Settings(api_token="t", openai_api_key="k", embedding_dimensions=4)
    http = AsyncMock()
    http.post.return_value = httpx.Response(
        200, json={"data": [{"embedding": [0.1]}]}, request=httpx.Request("POST", "https://test"))
    with pytest.raises(HTTPException) as error:
        await ContextService(http, cfg).embed("hello")
    assert error.value.status_code == 503


async def test_pipeline_roles_and_untrusted_evidence():
    from app.main import session

    async def fake_db():
        yield object()

    app.dependency_overrides[session] = fake_db
    app.state.pre = AsyncMock()
    app.state.pre.run.return_value = {"text": "Hello", "safety_passed": True}
    app.state.context = AsyncMock()
    app.state.context.build.return_value = {"text": "[]", "documents": [], "web": []}
    try:
        async with client() as c:
            r = await c.post("/v1/pipeline", headers=AUTH, json={"text": "Hello"})
        assert r.status_code == 200
        messages = r.json()["messages"]
        assert [m["role"] for m in messages] == ["system", "user", "user"]
        assert "Untrusted context" in messages[-1]["content"]
    finally:
        app.dependency_overrides.clear()


async def test_database_tenant_isolation():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models import Base, Document
    from app.settings import settings

    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("Set DATABASE_URL or run tests through Compose")
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine)() as db:
            vector = [1.0] + [0.0] * (settings().embedding_dimensions - 1)
            db.add_all([
                Document(tenant="test-a", title="A", content="A", embedding=vector),
                Document(tenant="test-b", title="B", content="B", embedding=vector),
            ])
            await db.flush()
            service = ContextService(None, settings())
            service.embed = AsyncMock(return_value=vector)
            docs = await service.retrieve(db, "test-a", "query", 20)
            assert docs and all(d["title"] == "A" for d in docs)
            await db.rollback()
    finally:
        await engine.dispose()
