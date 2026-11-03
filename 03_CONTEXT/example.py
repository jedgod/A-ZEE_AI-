"""End-to-end example: 02_PREPROCESS -> 03_CONTEXT. Run from AZ_AI/: python 03_CONTEXT/example.py"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "02_PREPROCESS"), str(ROOT / "03_CONTEXT")]

from azai_core.types import RequestContext, RetrievedDocument  # noqa: E402
from context_pipeline import ContextPipeline  # noqa: E402
from document_retrieval import DocumentRetriever, InMemoryDocumentStore  # noqa: E402
from long_term_memory import LongTermMemoryStore  # noqa: E402
from preprocess import PreprocessPipeline  # noqa: E402
from session_memory import SessionMemoryStore  # noqa: E402

pre = PreprocessPipeline().run(
    "My email is john.doe@example.com and I need help with my account.",
    RequestContext(request_id="demo-1"),
)
print("Redacted:", pre.pii_redacted_text)
print("Language:", pre.language, "| safe:", pre.safety_passed, "| redacted:", pre.metadata["redaction_counts"])

docs = [
    RetrievedDocument(doc_id="1", title="Account Help", content="How to reset your account password."),
    RetrievedDocument(doc_id="2", title="Billing", content="How to update billing details."),
]
ltm = LongTermMemoryStore()
ltm.upsert("user_pref", "User prefers concise answers about their account", importance=0.8)
sessions = SessionMemoryStore()
sessions.append("sess-1", "user", "Hello")
sessions.append("sess-1", "assistant", "Hi, how can I help?")

context = ContextPipeline(DocumentRetriever(InMemoryDocumentStore(docs)), ltm, sessions).build(
    query=pre.pii_redacted_text, session_id="sess-1"
)
print("\n--- Compacted context ---\n" + context.compacted_context)
