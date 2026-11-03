"""03_CONTEXT orchestrator: session + long-term memory + documents + tools + web -> compacted context."""
from __future__ import annotations

from typing import List, Optional

from azai_core.logger import get_logger
from azai_core.types import ContextBundle
from context_compaction import CompactionConfig, ContextCompactor, ContextSection
from document_retrieval import DocumentRetriever
from long_term_memory import LongTermMemoryStore
from session_memory import SessionMemoryStore
from tool_context import ToolCall, ToolContextBuilder
from web_retrieval import WebRetriever

logger = get_logger(__name__)

__all__ = ["ContextPipeline"]


class ContextPipeline:
    def __init__(
        self,
        document_retriever: DocumentRetriever,
        long_term_memory: LongTermMemoryStore,
        session_memory: SessionMemoryStore,
        web_retriever: Optional[WebRetriever] = None,
        compaction: Optional[CompactionConfig] = None,
    ):
        self.document_retriever = document_retriever
        self.long_term_memory = long_term_memory
        self.session_memory = session_memory
        self.web_retriever = web_retriever or WebRetriever()
        self.compactor = ContextCompactor(compaction)
        self.tool_builder = ToolContextBuilder()

    def build(
        self,
        query: str,
        session_id: Optional[str] = None,
        tool_calls: Optional[List[ToolCall]] = None,
    ) -> ContextBundle:
        tool_calls = tool_calls or []
        docs = self.document_retriever.retrieve(query, top_k=5)
        memories = self.long_term_memory.search(query, limit=10)
        session_summary = self.session_memory.summarize(session_id, limit=20) if session_id else ""
        tools = self.tool_builder.build(tool_calls)
        web_results = self.web_retriever.search(query, top_k=5)

        # Priority order: what was just said, what the user told us before, tool output,
        # then reference material. Empty sections are skipped entirely.
        compacted_context = self.compactor.compact([
            ContextSection("Conversation so far", session_summary, keep="tail"),
            ContextSection("Remembered about the user", "\n".join(f"- {m}" for m in memories)),
            ContextSection("Tool results", self.tool_builder.render(tool_calls)),
            ContextSection("Documents", "\n\n".join(f"[{d.title}] {d.content}" for d in docs)),
            ContextSection("Web results", "\n".join(f"- {w['title']} ({w['url']}): {w['snippet']}" for w in web_results)),
        ])

        return ContextBundle(
            session_summary=session_summary,
            memory_items=memories,
            retrieved_documents=docs,
            tool_context=tools,
            web_results=web_results,
            compacted_context=compacted_context,
        )
