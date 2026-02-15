"""
LiteLLM custom callback: extract <think>...</think> from content into reasoning_content.

Works for any model that emits reasoning inside <think> tags (MiniMax-M2.5, etc.)
when the inference backend does not natively separate reasoning_content.
"""

import re
from typing import Any, AsyncGenerator

from litellm.integrations.custom_logger import CustomLogger
from litellm.types.utils import ModelResponse, ModelResponseStream

_THINK_RE = re.compile(r"<think>([\s\S]*?)</think>", re.IGNORECASE)
_OPEN = "<think>"
_CLOSE = "</think>"


def _extract_think_blocks(text: str) -> tuple[str, str]:
    """Regex extraction for complete responses. Returns (cleaned, reasoning)."""
    parts: list[str] = []

    def _repl(m: re.Match) -> str:
        inner = m.group(1).strip()
        if inner:
            parts.append(inner)
        return ""

    cleaned = _THINK_RE.sub(_repl, text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, "\n".join(parts)


def _parse_chunk(text: str, in_think: bool) -> tuple[str, str, bool]:
    """Character-level state machine for streaming chunks.
    Returns (content_out, reasoning_out, new_in_think).
    """
    c: list[str] = []
    r: list[str] = []
    i = 0
    while i < len(text):
        lo = text[i:].lower()
        if not in_think and lo.startswith(_OPEN):
            in_think = True
            i += len(_OPEN)
            continue
        if in_think and lo.startswith(_CLOSE):
            in_think = False
            i += len(_CLOSE)
            continue
        (r if in_think else c).append(text[i])
        i += 1
    return "".join(c), "".join(r), in_think


class ThinkBlockParser(CustomLogger):
    """Extract <think> blocks into reasoning_content for all models."""

    # ---- non-streaming ----
    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
    ) -> Any:
        if not isinstance(response, ModelResponse):
            return response
        for choice in getattr(response, "choices", []):
            msg = getattr(choice, "message", None)
            if not msg:
                continue
            raw = getattr(msg, "content", None) or ""
            if "<think>" not in raw.lower():
                continue
            cleaned, reasoning = _extract_think_blocks(raw)
            existing = getattr(msg, "reasoning_content", None) or ""
            msg.content = cleaned
            if reasoning:
                msg.reasoning_content = (
                    f"{existing}\n{reasoning}" if existing else reasoning
                )
        return response

    # ---- streaming ----
    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: Any,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        in_think = False

        async for chunk in response:
            choices = getattr(chunk, "choices", None)
            if not choices:
                yield chunk
                continue

            for choice in choices:
                delta = getattr(choice, "delta", None)
                if not delta:
                    continue
                content = getattr(delta, "content", None)
                if not content:
                    continue

                c_text, r_text, in_think = _parse_chunk(content, in_think)

                delta.content = c_text if c_text else None
                if r_text:
                    prev = getattr(delta, "reasoning_content", None) or ""
                    delta.reasoning_content = prev + r_text

            yield chunk


# Instance that LiteLLM discovers via the `callbacks` config key.
think_parser = ThinkBlockParser()
