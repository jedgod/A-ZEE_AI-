from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Union

from azai_core.errors import ContextCompactionError
from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["CompactionConfig", "ContextSection", "ContextCompactor"]

ELLIPSIS = "…"


@dataclass
class CompactionConfig:
    max_chars: int = 4000


@dataclass
class ContextSection:
    title: str
    text: str
    # "tail" keeps the most recent end (conversation history); "head" keeps the start (documents).
    keep: str = "head"


class ContextCompactor:
    """
    Fits context into a character budget. Sections are added in priority order; the first section
    that doesn't fit is trimmed (from the side its `keep` setting allows) and the rest are dropped.
    Plain strings are accepted for backwards compatibility and treated as untitled "tail" sections.
    """

    def __init__(self, config: Optional[CompactionConfig] = None):
        self.config = config or CompactionConfig()
        if self.config.max_chars < 1:
            raise ContextCompactionError("max_chars must be positive")

    def compact(self, chunks: Sequence[Union[str, ContextSection]]) -> str:
        sections: List[Tuple[str, str, str]] = []
        for chunk in chunks:
            section = chunk if isinstance(chunk, ContextSection) else ContextSection("", chunk or "", "tail")
            text = (section.text or "").strip()
            if text:
                sections.append((section.title, text, section.keep))

        parts: List[str] = []
        budget = self.config.max_chars
        for title, text, keep in sections:
            header = f"## {title}\n" if title else ""
            separator = 2 if parts else 0
            block = header + text
            if len(block) + separator <= budget:
                parts.append(block)
                budget -= len(block) + separator
                continue
            room = budget - separator - len(header) - len(ELLIPSIS)
            if room > 0:
                body = ELLIPSIS + text[-room:] if keep == "tail" else text[:room] + ELLIPSIS
                parts.append(header + body)
            logger.info("context compacted to %d chars; trimmed section %r", self.config.max_chars, title or "untitled")
            break

        return "\n\n".join(parts)
