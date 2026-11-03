from __future__ import annotations

from dataclasses import dataclass

from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["LanguageDetectionResult", "LanguageDetector"]


@dataclass
class LanguageDetectionResult:
    language: str
    confidence: float


# Unicode script ranges that identify a language on their own.
_SCRIPTS = [
    ("ja", 0.95, [(0x3040, 0x30FF)]),                      # Hiragana / Katakana (checked before Han)
    ("ko", 0.95, [(0xAC00, 0xD7AF), (0x1100, 0x11FF)]),    # Hangul
    ("zh", 0.90, [(0x4E00, 0x9FFF), (0x3400, 0x4DBF)]),    # Han
    ("ru", 0.80, [(0x0400, 0x04FF)]),                      # Cyrillic
    ("ar", 0.85, [(0x0600, 0x06FF)]),                      # Arabic
    ("hi", 0.85, [(0x0900, 0x097F)]),                      # Devanagari
    ("el", 0.90, [(0x0370, 0x03FF)]),                      # Greek
    ("he", 0.90, [(0x0590, 0x05FF)]),                      # Hebrew
    ("th", 0.90, [(0x0E00, 0x0E7F)]),                      # Thai
]

# Latin-script hints: distinctive characters and very common words.
_LATIN_HINTS = {
    "es": ("¿¡ñ", {"el", "la", "los", "las", "que", "de", "y", "es", "por", "para", "con", "una"}),
    "de": ("äöüß", {"der", "die", "das", "und", "ist", "nicht", "ich", "mit", "ein", "eine"}),
    "fr": ("çœàèùâêîôû", {"le", "la", "les", "et", "est", "pas", "je", "vous", "une", "des", "pour"}),
    "pt": ("ãõ", {"o", "os", "não", "uma", "com", "para", "que", "é", "da", "do"}),
    "it": ("òì", {"il", "gli", "che", "non", "una", "per", "con", "è", "della"}),
    "en": ("", {"the", "and", "is", "are", "you", "to", "of", "it", "that", "with", "for", "this"}),
}

_PUNCTUATION = ".,;:!?¿¡\"'()"


class LanguageDetector:
    """
    Dependency-free language detector: Unicode scripts first, then Latin-script hints.

    For production-grade accuracy on short or mixed text, swap in fastText, langid, or CLD3
    behind the same detect() interface.
    """

    def detect(self, text: str) -> LanguageDetectionResult:
        if not text or not text.strip():
            return LanguageDetectionResult(language="unknown", confidence=0.0)

        letters = [ch for ch in text if ch.isalpha()]
        if not letters:
            return LanguageDetectionResult(language="unknown", confidence=0.0)

        for language, confidence, ranges in _SCRIPTS:
            hits = sum(1 for ch in letters if any(lo <= ord(ch) <= hi for lo, hi in ranges))
            if hits / len(letters) >= 0.3:
                return LanguageDetectionResult(language=language, confidence=confidence)

        lowered = text.lower()
        words = {w.strip(_PUNCTUATION) for w in lowered.split()}
        scores = {
            lang: 2 * sum(1 for ch in chars if ch in lowered) + len(words & common)
            for lang, (chars, common) in _LATIN_HINTS.items()
        }
        best = max(scores, key=lambda lang: scores[lang])
        if scores[best] == 0:
            return LanguageDetectionResult(language="en", confidence=0.4)
        runner_up = max(v for k, v in scores.items() if k != best)
        confidence = round(min(0.95, 0.5 + 0.1 * (scores[best] - runner_up)), 2)
        return LanguageDetectionResult(language=best, confidence=confidence)
