# OpenAI-Compatible Endpoints

## /v1/models
- Implemented in `controller/src/routes/models.ts`.
- Uses inference backend model list; returns OpenAI-style model list.
- Used by frontend model picker and external clients.

## /v1/chat/completions
- Implemented in `controller/src/routes/proxy.ts`.
- For **streaming** with tools: may route direct to inference for tool-call handling.
- For **non-streaming**: routes through LiteLLM and normalizes tool calls if needed.
- Maintains OpenAI response shape (choices, usage, tool_calls).

## Compatibility Notes
- Keep response format stable (don’t rename fields).
- Tool-call parsing includes fallback for models that emit tool calls in text.
- UTF-8 cleanup is applied for known tokenizer issues (GLM).
