import logging
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "02_PREPROCESS"), str(ROOT / "03_CONTEXT")]
logging.disable(logging.CRITICAL)

from azai_core.errors import MemoryStoreError, RetrievalError  # noqa: E402
from azai_core.types import RetrievedDocument  # noqa: E402
from context_compaction import CompactionConfig, ContextCompactor, ContextSection  # noqa: E402
from context_pipeline import ContextPipeline  # noqa: E402
from document_retrieval import DocumentRetriever, InMemoryDocumentStore  # noqa: E402
from long_term_memory import LongTermMemoryStore  # noqa: E402
from session_memory import SessionMemoryStore  # noqa: E402
from tool_context import ToolCall, ToolContextBuilder  # noqa: E402
from web_retrieval import WebResult, WebRetriever  # noqa: E402

DOCS = [
    RetrievedDocument(doc_id="1", title="Account Help", content="How to reset your account password."),
    RetrievedDocument(doc_id="2", title="Billing", content="How to update billing details and cards."),
    RetrievedDocument(doc_id="3", title="Shipping", content="Track a cart order."),
]


class CompactionTest(unittest.TestCase):
    def test_fits_and_skips_empty_sections(self):
        out = ContextCompactor().compact([ContextSection("A", "one"), ContextSection("B", "  "), "plain"])
        self.assertEqual(out, "## A\none\n\nplain")

    def test_trims_by_priority_and_direction(self):
        compactor = ContextCompactor(CompactionConfig(max_chars=30))
        tail = compactor.compact([ContextSection("Chat", "x" * 10 + "RECENT", keep="tail"), ContextSection("Docs", "zzz")])
        self.assertTrue(tail.endswith("RECENT"))
        head = compactor.compact([ContextSection("Doc", "START" + "y" * 50)])
        self.assertTrue(head.startswith("## Doc\nSTART") and head.endswith("…"))
        self.assertLessEqual(len(head), 30)


class DocumentRetrievalTest(unittest.TestCase):
    def test_whole_word_scoring_ignores_stopwords(self):
        docs = DocumentRetriever(InMemoryDocumentStore(DOCS)).retrieve("How do I reset my account password?")
        self.assertEqual([d.doc_id for d in docs], ["1"])
        self.assertEqual(docs[0].score, 5.0)  # title: "account" x2 = 2; body: "reset", "account", "password" = 3
        self.assertEqual(DOCS[0].score, 0.0)  # originals untouched
        self.assertEqual(DocumentRetriever(InMemoryDocumentStore(DOCS)).retrieve("car"), [])

    def test_store_failures_become_retrieval_errors(self):
        class Broken:
            def search(self, query, top_k=5):
                raise ConnectionError("db down")
        with self.assertRaises(RetrievalError):
            DocumentRetriever(Broken()).retrieve("x")


class MemoryTest(unittest.TestCase):
    def test_long_term_search_by_words(self):
        ltm = LongTermMemoryStore()
        ltm.upsert("user_pref", "User prefers concise answers", importance=0.8)
        ltm.upsert("timezone", "User is in Pacific time", importance=0.3)
        self.assertEqual(ltm.search("Please keep your answer concise"), ["User prefers concise answers"])
        self.assertEqual(ltm.get("timezone"), "User is in Pacific time")
        self.assertTrue(ltm.delete("timezone"))
        with self.assertRaises(MemoryStoreError):
            ltm.upsert("k", "v", importance=2)

    def test_long_term_eviction(self):
        ltm = LongTermMemoryStore(max_items=2)
        ltm.upsert("a", "alpha", importance=0.9)
        ltm.upsert("b", "beta", importance=0.1)
        ltm.upsert("c", "gamma", importance=0.5)
        self.assertIsNone(ltm.get("b"))

    def test_session_history(self):
        sessions = SessionMemoryStore(max_events_per_session=3)
        for i in range(5):
            sessions.append("s1", "user", f"m{i}")
        self.assertEqual([e.content for e in sessions.get_history("s1")], ["m2", "m3", "m4"])
        self.assertEqual(sessions.summarize("s1", limit=1), "user: m4")
        self.assertEqual(sessions.summarize("nope"), "")
        with self.assertRaises(MemoryStoreError):
            sessions.append("s1", "robot", "x")


class ToolAndWebTest(unittest.TestCase):
    def test_tool_context_clips_and_renders(self):
        calls = [ToolCall("search", {"q": "x"}, result="r" * 5000, success=True), ToolCall("calc", {}, error="boom")]
        built = ToolContextBuilder().build(calls)
        self.assertEqual(len(built["tool_calls"][0]["result"]), 2001)
        rendered = ToolContextBuilder().render(calls)
        self.assertIn('- search({"q": "x"}) -> ok', rendered)
        self.assertIn("- calc({}) -> failed: boom", rendered)
        self.assertEqual(ToolContextBuilder().render([]), "")

    def test_web_disabled_returns_nothing_not_fake_results(self):
        self.assertEqual(WebRetriever().search("anything"), [])

    def test_web_provider(self):
        class Provider:
            def search(self, query, top_k):
                return [WebResult("T", "https://e.org", f"about {query}")] * 3
        self.assertEqual(WebRetriever(Provider()).search("x", top_k=2), [{"title": "T", "url": "https://e.org", "snippet": "about x"}] * 2)


class ContextPipelineTest(unittest.TestCase):
    def test_end_to_end(self):
        ltm = LongTermMemoryStore()
        ltm.upsert("user_pref", "User prefers concise answers about the account", importance=0.8)
        sessions = SessionMemoryStore()
        sessions.append("sess-1", "user", "Hello")
        sessions.append("sess-1", "assistant", "Hi, how can I help?")
        pipeline = ContextPipeline(DocumentRetriever(InMemoryDocumentStore(DOCS)), ltm, sessions)
        ctx = pipeline.build("I need help with my account password", session_id="sess-1",
                             tool_calls=[ToolCall("lookup", {"id": 7}, result={"plan": "pro"}, success=True)])
        self.assertEqual([d.doc_id for d in ctx.retrieved_documents], ["1"])
        self.assertEqual(ctx.web_results, [])
        text = ctx.compacted_context
        self.assertLess(text.index("## Conversation so far"), text.index("## Remembered about the user"))
        self.assertIn("[Account Help] How to reset your account password.", text)
        self.assertIn('{"plan": "pro"}', text)
        self.assertNotIn("Web results", text)
        self.assertNotIn("example.com", text)


if __name__ == "__main__":
    unittest.main()
