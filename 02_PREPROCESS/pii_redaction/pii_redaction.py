from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Pattern, Tuple

from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["RedactionResult", "PIIRedactor", "luhn_valid"]


@dataclass
class RedactionResult:
    redacted_text: str
    # Labels only (e.g. ["email", "phone"]). The redacted values are never kept,
    # so results and logs can't leak the PII that was just removed.
    entities_redacted: List[str] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)


def luhn_valid(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def _always(_: str) -> bool:
    return True


class PIIRedactor:
    """
    Deterministic regex-based PII redactor. Order matters: specific formats run first so
    that, for example, card numbers aren't partly consumed by the phone pattern.
    In production, augment with NER-based detection (names, addresses).
    """

    def __init__(self):
        self.patterns: List[Tuple[str, Pattern[str], Callable[[str], bool]]] = [
            ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), _always),
            # 13-19 digits with optional single spaces/dashes; must pass the Luhn checksum.
            ("credit_card", re.compile(r"(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])"), luhn_valid),
            ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), _always),
            (
                "phone",
                re.compile(r"(?<![\w+])(?:\+\d{1,3}[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}(?!\w)"),
                _always,
            ),
            ("ipv4", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"), _always),
        ]

    def redact(self, text: str) -> RedactionResult:
        if not text:
            return RedactionResult(redacted_text="")

        redacted = text
        counts: Counter[str] = Counter()

        for label, pattern, accept in self.patterns:
            def replace(match: re.Match[str], label: str = label, accept: Callable[[str], bool] = accept) -> str:
                if not accept(match.group(0)):
                    return match.group(0)
                counts[label] += 1
                return f"[REDACTED_{label.upper()}]"

            redacted = pattern.sub(replace, redacted)

        if counts:
            logger.info("redacted PII: %s", dict(counts))
        return RedactionResult(redacted_text=redacted, entities_redacted=sorted(counts), counts=dict(counts))
