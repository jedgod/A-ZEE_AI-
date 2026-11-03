from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["NormalizationConfig", "InputNormalizer"]


@dataclass
class NormalizationConfig:
    # Lowercasing loses meaning in code, names, and acronyms, so it's off by default.
    lowercase: bool = False
    collapse_whitespace: bool = True
    # Keep line breaks (code, lists); only runs of spaces/tabs and 3+ blank lines are collapsed.
    preserve_newlines: bool = True
    normalize_unicode: bool = True
    strip_control_chars: bool = True
    remove_zero_width: bool = True


class InputNormalizer:
    def __init__(self, config: Optional[NormalizationConfig] = None):
        self.config = config or NormalizationConfig()

    def normalize(self, text: Optional[str]) -> str:
        if text is None:
            return ""

        output = text.replace("\r\n", "\n").replace("\r", "\n")

        if self.config.normalize_unicode:
            output = unicodedata.normalize("NFKC", output)

        if self.config.remove_zero_width:
            # Zero-width joiners (U+200C/U+200D) stay: emoji and several scripts depend on them.
            output = re.sub(r"[\u200B\u2060\uFEFF]", "", output)

        if self.config.strip_control_chars:
            output = "".join(ch for ch in output if ch.isprintable() or ch in "\n\t ")

        if self.config.lowercase:
            output = output.lower()

        if self.config.collapse_whitespace:
            if self.config.preserve_newlines:
                # Keep each line's indentation (code), collapse runs inside it, drop trailing spaces.
                lines = []
                for line in output.split("\n"):
                    indent = re.match(r"[ \t]*", line).group(0)
                    lines.append(indent + re.sub(r"[ \t]+", " ", line[len(indent):]).rstrip())
                # Drop blank lines at both ends but keep the first line's indentation.
                output = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip("\n")
            else:
                output = re.sub(r"\s+", " ", output).strip()

        return output
