<!-- CRITICAL -->
# vLLM Studio vs Competitors

## Summary
vLLM Studio combines a controller-managed inference stack, a Chat UI, and OpenAI-compatible endpoints in one product. Competitors typically focus on either local model hosting, UI-only chat, or a proxy gateway rather than the full stack.

## Comparison Table

| Product | Primary Focus | OpenAI-Compatible API | Typical Deployment | Notable Differences vs vLLM Studio |
| --- | --- | --- | --- | --- |
| LM Studio | Local desktop app + local model serving | OpenAI-compatible endpoints (also Anthropic-compatible) | Desktop app with local server | Strong desktop UX; lacks controller-level orchestration + agent runtime. |
| Open WebUI | Web UI for LLMs | Expects OpenAI-compatible backends | Docker/self-hosted UI | UI-first; depends on external OpenAI-compatible servers. |
| Ollama | Local model runner | OpenAI-compatible `/v1/chat/completions` | Local daemon/CLI | Model runtime only; no integrated UI + controller orchestration. |
| vLLM | High-throughput inference server | OpenAI-compatible server | CLI server or Docker | Inference server only; no UI + controller + tools runtime. |
| text-generation-webui (oobabooga) | Local UI + model serving | OpenAI-compatible API mode | Local Python app | UI + model server; less focus on controller-managed orchestration. |
| LiteLLM Proxy | OpenAI-compatible gateway | OpenAI-compatible gateway endpoints | Docker/service proxy | Gateway only; no UI or integrated model runner. |

## Notes
- LM Studio provides a local API server and supports OpenAI- and Anthropic-compatible endpoints. Source: https://lmstudio.ai/docs/developer/core/server
- LM Studio OpenAI-compatible endpoints list: https://lmstudio.ai/docs/developer/openai-compat
- Open WebUI connects to OpenAI-compatible backends and focuses on the Chat Completions protocol. Source: https://docs.openwebui.com/getting-started/quick-start/starting-with-openai-compatible/
- Ollama exposes OpenAI-compatible `/v1/chat/completions`. Source: https://ollama.com/blog/openai-compatibility
- vLLM documents OpenAI-compatible server support. Source: https://docs.vllm.ai/en/stable/serving/openai_compatible_server/
- text-generation-webui provides an OpenAI-compatible API mode. Source: https://github.com/oobabooga/text-generation-webui/wiki/12-%E2%80%90-OpenAI-API
- LiteLLM Proxy is an OpenAI-compatible gateway. Source: https://docs.litellm.ai/docs/providers/litellm_proxy
