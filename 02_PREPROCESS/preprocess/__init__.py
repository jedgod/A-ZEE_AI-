"""02_PREPROCESS orchestrator: normalize -> detect language -> redact PII -> safety check -> package."""
from __future__ import annotations

from typing import Optional

from azai_core.types import PreprocessResult, RequestContext
from language_detect import LanguageDetector
from normalize_input import InputNormalizer
from pii_redaction import PIIRedactor
from prompt_packaging import PromptPackager
from safety_filter import SafetyFilter

__all__ = ["PreprocessPipeline"]


class PreprocessPipeline:
    def __init__(
        self,
        detector: Optional[LanguageDetector] = None,
        normalizer: Optional[InputNormalizer] = None,
        redactor: Optional[PIIRedactor] = None,
        safety: Optional[SafetyFilter] = None,
        packager: Optional[PromptPackager] = None,
    ):
        self.detector = detector or LanguageDetector()
        self.normalizer = normalizer or InputNormalizer()
        self.redactor = redactor or PIIRedactor()
        self.safety = safety or SafetyFilter()
        self.packager = packager or PromptPackager()

    def run(self, text: str, request_context: Optional[RequestContext] = None) -> PreprocessResult:
        request_context = request_context or RequestContext()

        normalized = self.normalizer.normalize(text)
        lang_result = self.detector.detect(normalized)
        redaction_result = self.redactor.redact(normalized)
        # Check the normalized text so redaction placeholders can't hide blocked phrases.
        safety_result = self.safety.check(normalized)

        packaged_prompt = None
        if safety_result.passed:
            pkg = self.packager.package(
                user_text=redaction_result.redacted_text,
                language=lang_result.language,
                context=request_context.metadata,
            )
            packaged_prompt = f"{pkg.system_prompt}\n\n{pkg.user_prompt}"

        return PreprocessResult(
            original_text=text,
            normalized_text=normalized,
            language=lang_result.language,
            pii_redacted_text=redaction_result.redacted_text,
            safety_passed=safety_result.passed,
            safety_reasons=safety_result.reasons,
            packaged_prompt=packaged_prompt,
            metadata={
                "language_confidence": lang_result.confidence,
                "redacted_entities": redaction_result.entities_redacted,
                "redaction_counts": redaction_result.counts,
                "request_id": request_context.request_id,
            },
        )
