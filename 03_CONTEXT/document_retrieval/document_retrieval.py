from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import List, Protocol

from azai_core.errors import RetrievalError
from azai_core.logger import get_logger
from azai_core.types import RetrievedDocument

logger = get_logger(__name__)

__all__ = ["DocumentStore", "InMemoryDocumentStore", "DocumentRetriever", "tokenize"]

_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are", "my", "i", "me",
    "how", "do", "what", "with", "it", "this", "that", "need", "help", "can", "you", "your",
}


def tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS and len(t) > 1]


class DocumentStore(Protocol):
    def search(self, query: str, top_k: int = 5) -> List[RetrievedDocument]:
        ...


@dataclass
class InMemoryDocumentStore:
    """Keyword-overlap search; fine for tests and small corpora. Use a vector store in production."""

    documents: List[RetrievedDocument]

    def search(self, query: str, top_k: int = 5) -> List[RetrievedDocument]:
        query_tokens = set(tokenize(query))
        if not query_tokens:
            return []
        scored = []
        for doc in self.documents:
            title_tokens = set(tokenize(doc.title))
            body_tokens = set(tokenize(doc.content))
            # Title matches count double; scores are whole-word, so "car" doesn't match "cart".
            score = 2.0 * len(query_tokens & title_tokens) + len(query_tokens & body_tokens)
            if score > 0:
                scored.append(replace(doc, score=score))
        scored.sort(key=lambda d: d.score, reverse=True)
        return scored[:top_k]


class DocumentRetriever:
    def __init__(self, store: DocumentStore):
        self.store = store

    def retrieve(self, query: str, top_k: int = 5) -> List[RetrievedDocument]:
        if top_k < 1:
            return []
        try:
            return self.store.search(query=query, top_k=top_k)
        except Exception as error:  # store backends raise many error types
            logger.exception("document retrieval failed")
            raise RetrievalError(str(error)) from error
