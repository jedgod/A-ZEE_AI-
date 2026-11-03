from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from azai_core.errors import MemoryStoreError
from document_retrieval import tokenize

__all__ = ["MemoryItem", "LongTermMemoryStore"]


def _related(a: str, b: str) -> bool:
    """Same word, or one is a prefix of the other ("answer"/"answers", "concise"/"concisely")."""
    return a == b or (min(len(a), len(b)) >= 4 and (a.startswith(b) or b.startswith(a)))


@dataclass
class MemoryItem:
    key: str
    value: str
    timestamp: float = field(default_factory=time.time)
    importance: float = 0.5


class LongTermMemoryStore:
    """
    In-process memory store. For production, back this with an encrypted database table
    and keep the same upsert/get/search interface.
    """

    def __init__(self, max_items: int = 1000):
        self._store: Dict[str, MemoryItem] = {}
        self.max_items = max_items

    def upsert(self, key: str, value: str, importance: float = 0.5) -> None:
        if not key or not value:
            raise MemoryStoreError("key and value are required")
        if not 0.0 <= importance <= 1.0:
            raise MemoryStoreError("importance must be between 0 and 1")
        self._store[key] = MemoryItem(key=key, value=value, importance=importance)
        if len(self._store) > self.max_items:
            # Evict the least important, then oldest, item.
            victim = min(self._store.values(), key=lambda m: (m.importance, m.timestamp))
            del self._store[victim.key]

    def get(self, key: str) -> Optional[str]:
        item = self._store.get(key)
        return item.value if item else None

    def delete(self, key: str) -> bool:
        return self._store.pop(key, None) is not None

    def search(self, query: str, limit: int = 10) -> List[str]:
        # Word overlap rather than whole-query substring: a full sentence like
        # "how should you answer me" still finds "User prefers concise answers".
        query_tokens = set(tokenize(query))
        if not query_tokens:
            return []
        ranked = []
        for item in self._store.values():
            item_tokens = set(tokenize(f"{item.key} {item.value}"))
            overlap = sum(1 for q in query_tokens if any(_related(q, t) for t in item_tokens))
            if overlap:
                ranked.append((overlap + item.importance, item.timestamp, item.value))
        ranked.sort(reverse=True)
        return [value for _, _, value in ranked[:limit]]
