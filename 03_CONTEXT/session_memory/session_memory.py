from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List

from azai_core.errors import MemoryStoreError

__all__ = ["SessionEvent", "SessionMemoryStore"]

ROLES = {"user", "assistant", "system", "tool"}


@dataclass
class SessionEvent:
    role: str
    content: str
    timestamp: float = field(default_factory=time.time)


class SessionMemoryStore:
    """In-process per-session history, capped per session. Back with a database for multi-instance use."""

    def __init__(self, max_events_per_session: int = 200):
        self._sessions: Dict[str, List[SessionEvent]] = {}
        self.max_events = max_events_per_session

    def append(self, session_id: str, role: str, content: str) -> None:
        if not session_id:
            raise MemoryStoreError("session_id is required")
        if role not in ROLES:
            raise MemoryStoreError(f"role must be one of {sorted(ROLES)}")
        events = self._sessions.setdefault(session_id, [])
        events.append(SessionEvent(role=role, content=content))
        del events[:-self.max_events]

    def get_history(self, session_id: str, limit: int = 20) -> List[SessionEvent]:
        if limit < 1:
            return []
        return list(self._sessions.get(session_id, [])[-limit:])

    def clear(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def summarize(self, session_id: str, limit: int = 20) -> str:
        history = self.get_history(session_id, limit=limit)
        return "\n".join(f"{item.role}: {item.content}" for item in history)
