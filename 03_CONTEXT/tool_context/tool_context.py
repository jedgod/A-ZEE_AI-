from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List

__all__ = ["ToolCall", "ToolContextBuilder"]

MAX_RESULT_CHARS = 2000


@dataclass
class ToolCall:
    tool_name: str
    arguments: Dict[str, Any]
    result: Any = None
    success: bool = False
    error: str = ""


def _clip(value: Any) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "…"


class ToolContextBuilder:
    def build(self, tool_calls: List[ToolCall]) -> Dict[str, Any]:
        return {
            "tool_calls": [
                {
                    "tool_name": t.tool_name,
                    "arguments": t.arguments,
                    # Large tool outputs are clipped so one call can't crowd out the rest of the context.
                    "result": _clip(t.result) if t.result is not None else None,
                    "success": t.success,
                    "error": t.error,
                }
                for t in tool_calls
            ]
        }

    def render(self, tool_calls: List[ToolCall]) -> str:
        """Readable text for the prompt; empty when there were no tool calls."""
        lines = []
        for call in self.build(tool_calls)["tool_calls"]:
            status = "ok" if call["success"] else f"failed: {call['error'] or 'unknown error'}"
            args = json.dumps(call["arguments"], ensure_ascii=False, default=str)
            line = f"- {call['tool_name']}({args}) -> {status}"
            if call["success"] and call["result"] is not None:
                result = call["result"] if isinstance(call["result"], str) else json.dumps(call["result"], ensure_ascii=False, default=str)
                line += f"\n  {result}"
            lines.append(line)
        return "\n".join(lines)
