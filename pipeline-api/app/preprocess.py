import asyncio
import unicodedata

import httpx
from fastapi import HTTPException
from langid.langid import LanguageIdentifier, model
from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine

# langid is unreliable on short strings such as titles and tool names ("search" is often
# classified as another language). Below this length, or below this confidence, text is
# analyzed as English; Presidio's pattern recognizers (email, phone, cards, IPs) are
# language-independent, so those entities are still caught.
LANGUAGE_MIN_CHARS = 40
LANGUAGE_MIN_CONFIDENCE = 0.9


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    # Preserve tabs, line breaks, casing, and joiners used by real scripts.
    return "".join(c for c in text if c in "\n\t" or unicodedata.category(c) not in {"Cc", "Cs"}).strip()


class Preprocessor:
    def __init__(self, client: httpx.AsyncClient, key: str, spacy_model: str = "en_core_web_lg"):
        self.client, self.key = client, key
        engine = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": spacy_model}],
        }).create_engine()
        self.analyzer = AnalyzerEngine(nlp_engine=engine, supported_languages=["en"])
        self.anonymizer = AnonymizerEngine()
        # Build the language model once; constructing it per call costs about a second.
        self.identifier = LanguageIdentifier.from_modelstring(model, norm_probs=True)
        # Serialize mutable NLP machinery while keeping the event loop free.
        self.lock = asyncio.Lock()

    def local(self, text: str) -> dict:
        language, confidence = self.identifier.classify(text)
        if language != "en":
            if len(text) >= LANGUAGE_MIN_CHARS and confidence >= LANGUAGE_MIN_CONFIDENCE:
                # Fail closed: name/location recognizers are English-only.
                raise HTTPException(422, "PII coverage unavailable for this language")
            language = "en"
        entities = self.analyzer.analyze(text=text, language="en")
        redacted = self.anonymizer.anonymize(text=text, analyzer_results=entities).text
        return {
            "text": redacted,
            "language": language,
            "confidence": float(confidence),
            "redacted_types": sorted({e.entity_type for e in entities}),
        }

    async def run(self, raw: str) -> dict:
        text = normalize(raw)
        if not text:
            raise HTTPException(422, "Input is empty after normalization")
        async with self.lock:
            result = await asyncio.to_thread(self.local, text)
        try:
            response = await self.client.post(
                "https://api.openai.com/v1/moderations",
                headers={"Authorization": "Bearer " + self.key},
                json={"model": "omni-moderation-latest", "input": result["text"]},
            )
            response.raise_for_status()
            flagged = response.json()["results"][0]["flagged"]
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            raise HTTPException(503, "Moderation unavailable") from exc
        if flagged:
            raise HTTPException(422, "Input rejected by moderation policy")
        return {**result, "safety_passed": True}
