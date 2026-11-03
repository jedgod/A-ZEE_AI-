from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

__all__ = ["PromptPackage", "PromptPackager", "DEFAULT_SYSTEM_PROMPT"]

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, accurate, and safe assistant. "
    "Follow policy, preserve user intent, and answer in the user's language."
)


@dataclass
class PromptPackage:
    system_prompt: str
    user_prompt: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    def as_messages(self) -> List[Dict[str, str]]:
        """Chat-completions style messages, ready for a model provider."""
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self.user_prompt},
        ]


class PromptPackager:
    def __init__(self, system_prompt: str = DEFAULT_SYSTEM_PROMPT):
        self.system_prompt = system_prompt

    def package(
        self,
        user_text: str,
        language: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> PromptPackage:
        context = context or {}

        user_prompt = f"[lang={language}] {user_text}"
        if context:
            # Readable, stable rendering (sorted keys) instead of a Python dict repr.
            lines = [
                f"- {key}: {value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)}"
                for key, value in sorted(context.items())
            ]
            user_prompt += "\n\nContext:\n" + "\n".join(lines)

        return PromptPackage(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            metadata={"language": language, "context_keys": sorted(context)},
        )
