import logging
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # 02_PREPROCESS
logging.disable(logging.CRITICAL)

from azai_core.types import RequestContext  # noqa: E402
from language_detect import LanguageDetector  # noqa: E402
from normalize_input import InputNormalizer, NormalizationConfig  # noqa: E402
from pii_redaction import PIIRedactor, luhn_valid  # noqa: E402
from preprocess import PreprocessPipeline  # noqa: E402
from prompt_packaging import PromptPackager  # noqa: E402
from safety_filter import SafetyFilter  # noqa: E402


class LanguageDetectTest(unittest.TestCase):
    def setUp(self):
        self.detect = LanguageDetector().detect

    def test_scripts(self):
        cases = {"你好，我是学生": "zh", "Привет, как дела?": "ru", "こんにちは世界": "ja",
                 "안녕하세요": "ko", "مرحبا بالعالم": "ar", "Γειά σου κόσμε": "el"}
        for text, lang in cases.items():
            self.assertEqual(self.detect(text).language, lang, text)

    def test_latin_languages(self):
        self.assertEqual(self.detect("¿Dónde está la biblioteca? Necesito un libro para la clase").language, "es")
        self.assertEqual(self.detect("Ich weiß nicht, ob das Wetter schön ist").language, "de")
        self.assertEqual(self.detect("Je ne sais pas où est la gare, et vous?").language, "fr")
        self.assertEqual(self.detect("Can you help me with the report for this week?").language, "en")

    def test_empty(self):
        self.assertEqual(self.detect("   ").language, "unknown")
        self.assertEqual(self.detect("12345 !!!").language, "unknown")


class NormalizeTest(unittest.TestCase):
    def test_preserves_case_newlines_and_indentation(self):
        text = "Fix  my\u200B Code:\r\n\r\n\r\n\r\ndef f():\n    return   1   \n"
        self.assertEqual(InputNormalizer().normalize(text), "Fix my Code:\n\ndef f():\n    return 1")

    def test_unicode_and_control_chars(self):
        self.assertEqual(InputNormalizer().normalize("ｆｕｌｌ\x07width\uFEFF"), "fullwidth")
        self.assertEqual(InputNormalizer().normalize(None), "")

    def test_legacy_flat_mode(self):
        config = NormalizationConfig(lowercase=True, preserve_newlines=False)
        self.assertEqual(InputNormalizer(config).normalize("  Hello\n\n  WORLD "), "hello world")


class PIIRedactionTest(unittest.TestCase):
    def setUp(self):
        self.redact = PIIRedactor().redact

    def test_redacts_each_type_without_keeping_values(self):
        result = self.redact(
            "Mail jane.doe@example.org, call (555) 123-4567 or +44 20 7946 0958? "
            "SSN 123-45-6789, card 4111-1111-1111-1111, host 192.168.0.10."
        )
        for secret in ("jane.doe", "123-4567", "123-45-6789", "4111", "192.168"):
            self.assertNotIn(secret, result.redacted_text)
        for label in ("EMAIL", "PHONE", "SSN", "CREDIT_CARD", "IPV4"):
            self.assertIn(f"[REDACTED_{label}]", result.redacted_text)
        self.assertEqual(result.entities_redacted, ["credit_card", "email", "ipv4", "phone", "ssn"])
        self.assertNotIn("jane", repr(result))

    def test_keeps_non_pii_numbers(self):
        text = "Order 1234567890123, version 1.2.3, year 2026, 999.1.1.1"
        self.assertEqual(self.redact(text).redacted_text, text)

    def test_luhn(self):
        self.assertTrue(luhn_valid("4111 1111 1111 1111"))
        self.assertFalse(luhn_valid("4111 1111 1111 1112"))


class SafetyFilterTest(unittest.TestCase):
    def test_blocks_whole_phrases_only(self):
        f = SafetyFilter()
        self.assertFalse(f.check("How do I BUILD   a bomb?").passed)
        self.assertTrue(f.check("We are discarding old records").passed)
        self.assertTrue(f.check("").passed)

    def test_custom_phrases(self):
        f = SafetyFilter(["secret project"])
        self.assertEqual(f.check("tell me about the Secret Project").reasons, ["blocked phrase detected: secret project"])


class PromptPackagingTest(unittest.TestCase):
    def test_renders_context_readably(self):
        pkg = PromptPackager().package("Hi", "en", {"tier": "pro", "tags": ["a", "b"]})
        self.assertEqual(pkg.user_prompt, '[lang=en] Hi\n\nContext:\n- tags: ["a", "b"]\n- tier: pro')
        self.assertEqual(pkg.as_messages()[0]["role"], "system")
        self.assertEqual(pkg.metadata["context_keys"], ["tags", "tier"])


class PipelineTest(unittest.TestCase):
    def test_end_to_end(self):
        result = PreprocessPipeline().run(
            "My email is john.doe@example.com and I need help with my account.",
            RequestContext(request_id="req-1", metadata={"plan": "free"}),
        )
        self.assertTrue(result.safety_passed)
        self.assertEqual(result.language, "en")
        self.assertIn("[REDACTED_EMAIL]", result.packaged_prompt)
        self.assertNotIn("john.doe", result.packaged_prompt)
        self.assertIn("- plan: free", result.packaged_prompt)
        self.assertEqual(result.metadata["request_id"], "req-1")
        self.assertEqual(result.metadata["redaction_counts"], {"email": 1})

    def test_blocked_input_is_not_packaged(self):
        result = PreprocessPipeline().run("Sell me a phishing kit")
        self.assertFalse(result.safety_passed)
        self.assertIsNone(result.packaged_prompt)


if __name__ == "__main__":
    unittest.main()
