# 02_PREPROCESS (Python)

Cleans a user message before it reaches context building or a model:
**normalize → detect language → redact PII → safety check → package prompt.**

| Module | Purpose |
|---|---|
| `normalize_input/` | Unicode NFKC, removes zero-width/control chars, collapses spaces. Keeps case, line breaks, and indentation by default. |
| `language_detect/` | Unicode-script detection (zh, ja, ko, ru, ar, hi, el, he, th) and Latin hints (en, es, de, fr, pt, it). |
| `pii_redaction/` | Email, Luhn-checked card numbers, SSN, phone, IPv4 → `[REDACTED_…]`. Reports labels and counts, never the values. |
| `safety_filter/` | Whole-word phrase blocklist. A placeholder: connect a moderation model for production. |
| `prompt_packaging/` | Builds system and user prompts; `as_messages()` for chat APIs. |
| `preprocess/` | `PreprocessPipeline` orchestrator. |
| `azai_core/` | Shared types, errors, and logger used by this stage and `03_CONTEXT`. |

Python 3.10+, standard library only. Folders starting with a digit can't be imported in
Python, so put this folder on the import path:

```python
import sys; sys.path.insert(0, "02_PREPROCESS")
from preprocess import PreprocessPipeline
result = PreprocessPipeline().run("My email is a@b.com")
```

Tests: `npm run test:py` (or `python -m unittest discover -s 02_PREPROCESS/tests`).
Not yet called by the Next.js app, which is TypeScript; see the repo notes on wiring.
