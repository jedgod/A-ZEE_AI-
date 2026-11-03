from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional

from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["SafetyResult", "SafetyFilter", "DEFAULT_BLOCKED_PHRASES"]

DEFAULT_BLOCKED_PHRASES = (
    "build a bomb",
    "make malware",
    "steal credentials",
    "carding",
    "phishing kit",
)


@dataclass
class SafetyResult:
    passed: bool
    reasons: List[str] = field(default_factory=list)


class SafetyFilter:
    """
    Basic phrase-based policy gate. It's a first line of defense only: phrase lists are easy to
    evade and can misfire on benign text. In production, connect a moderation classifier or
    policy engine behind the same check() interface.
    """

    def __init__(self, blocked_phrases: Optional[Iterable[str]] = None):
        phrases = DEFAULT_BLOCKED_PHRASES if blocked_phrases is None else tuple(blocked_phrases)
        # Whole-word, whitespace-tolerant matching: "build   a bomb" matches,
        # while "discarding" no longer matches "carding".
        self._patterns = [
            (phrase, re.compile(r"\b" + r"\s+".join(map(re.escape, phrase.lower().split())) + r"\b"))
            for phrase in phrases
        ]

    def check(self, text: str) -> SafetyResult:
        if not text:
            return SafetyResult(passed=True)

        lowered = text.lower()
        reasons = [f"blocked phrase detected: {phrase}" for phrase, pattern in self._patterns if pattern.search(lowered)]
        if reasons:
            logger.warning("safety filter blocked input (%d rule(s))", len(reasons))
        return SafetyResult(passed=not reasons, reasons=reasons)
