# pipeline-api: FastAPI service for stages 02–03

Async FastAPI service that **preprocesses** text (normalize, language check, Presidio PII redaction,
fail-closed OpenAI moderation) and builds **grounded context** (pgvector document search, session
and long-term memory in PostgreSQL 18, optional Brave web search, token-budgeted compaction, and an
optional LangChain RAG chain).

The AZ_AI Next.js app calls this service for document and memory retrieval when
`PIPELINE_API_URL` is set (see "Connect AZ_AI" below). Without it, the app's built-in
TypeScript pipeline still redacts, checks, and compacts every request.

## Endpoints (all except /healthz need `Authorization: Bearer $API_TOKEN`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/02/preprocess` | Normalize, detect language, redact PII, moderate |
| POST | `/v1/03/context` | Retrieve documents, read memory, add tool results, compact |
| POST | `/v1/pipeline` | Both stages; returns role-separated prompt messages |
| POST | `/v1/documents` · `/v1/memory` · `/v1/session` | Redact and moderate, then embed/persist (201) |
| POST | `/v1/rag` | LangChain retrieval-augmented answer (output is checked too) |
| GET | `/healthz` · `/readyz` | Liveness · database readiness (authenticated) |

Interactive docs: http://localhost:8000/docs

## Run with Docker (recommended)

```powershell
cd pipeline-api
copy .env.example .env      # set POSTGRES_PASSWORD, DATABASE_URL, API_TOKEN, OPENAI_API_KEY
docker compose up --build -d
docker compose run --rm api pytest -q   # includes the real-database tenant-isolation test
```

The `db` image compiles pgvector 0.8.1 against PostgreSQL 18; the API image installs `en_core_web_lg`.

## Run without Docker

Needs Python 3.12+ and a PostgreSQL 18 **with the pgvector extension** (the service runs
`CREATE EXTENSION vector` at startup). On Windows, pgvector must be built with Visual Studio's
`nmake` and copied into `C:\Program Files\PostgreSQL\18` from an **Administrator** prompt; see
https://github.com/pgvector/pgvector#windows.

```powershell
python -m venv .venv; .venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_lg     # or en_core_web_sm with SPACY_MODEL=en_core_web_sm
uvicorn app.main:app --port 8000            # or: python prototype.py
```

## Providers

- **Moderation** always uses OpenAI's `/v1/moderations` (it doesn't consume paid credits).
- **Embeddings** and the **RAG chat model** accept any OpenAI-compatible endpoint via
  `EMBEDDING_API_BASE`/`EMBEDDING_API_KEY` and `CHAT_API_BASE`/`CHAT_API_KEY` (keys default to
  `OPENAI_API_KEY`). Gemini works: base `https://generativelanguage.googleapis.com/v1beta/openai`,
  model `gemini-embedding-001` (returns the configured 1536 dimensions).
- Changing `EMBEDDING_DIMENSIONS` or the embedding model requires a migration and re-embedding.

## Connect AZ_AI (the Next.js app)

Add to `AZ_AI/.env.local`, then restart the app:

```
PIPELINE_API_URL=http://localhost:8000
PIPELINE_API_TOKEN=<same value as API_TOKEN>
# PIPELINE_API_TIMEOUT_MS=8000 (optional)
```

Each chat request then sends its (already redacted) question to `/v1/03/context` and attaches the
results to the user turn as untrusted reference material. If the service is down or slow, chat
continues without retrieved context.

## Tests

```powershell
pytest -q        # unit + API tests with mocked providers; DB test skips without DATABASE_URL
```

`prototype.py` is generated: after editing `app/`, run `python scripts/build_prototype.py`
(a test fails if you forget).

## What changed from the original kit
- Language check: short or low-confidence text (titles, tool names) is analyzed as English
  instead of being rejected; long, confidently non-English text still fails closed.
- The language model is built once, not on every call.
- Configurable OpenAI-compatible endpoints for embeddings and chat; configurable spaCy model.
- Dependency ranges match versions verified together (Python 3.14 locally, 3.12 in Docker).

## Before production
Replace the shared token with OIDC tenant claims; add row-level security, Alembic migrations,
audit logs, per-tenant quotas, encryption/retention controls, and backups; hash-lock
dependencies (`pip-compile --generate-hashes`); evaluate multilingual PII coverage, injection
resistance, moderation, and retrieval quality with your own data.
