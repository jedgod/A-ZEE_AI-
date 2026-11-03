from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RequestContext:
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None
    locale: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PreprocessResult:
    original_text: str
    normalized_text: str
    language: str
    pii_redacted_text: str
    safety_passed: bool
    safety_reasons: List[str] = field(default_factory=list)
    packaged_prompt: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievedDocument:
    doc_id: str
    title: str
    content: str
    score: float = 0.0
    source: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ContextBundle:
    session_summary: str = ""
    memory_items: List[str] = field(default_factory=list)
    retrieved_documents: List[RetrievedDocument] = field(default_factory=list)
    tool_context: Dict[str, Any] = field(default_factory=dict)
    web_results: List[Dict[str, Any]] = field(default_factory=list)
    compacted_context: str = ""
