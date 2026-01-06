# LiteLLM (API Gateway)

LiteLLM runs as a Docker service and acts as the OpenAI-compatible API gateway in front of the host inference server (vLLM/SGLang on port `8000`).

Key files:

- Service definition: `docker-compose.yml:22`
- Config: `config/litellm.yaml`
- Custom callback handler: `config/tool_call_handler.py`

## What LiteLLM does here

- Normalizes request/response formats (OpenAI-ish surface API).
- Routes `model` names to the configured `api_base` (`http://host.docker.internal:8000/v1` by default).
- Applies long timeouts for generation/streaming (600s in config).
- Optionally caches responses via Redis and writes spend logs to Postgres.

The controller can bypass LiteLLM for some “local truth” endpoints (like listing recipes/models), but chat requests typically go through LiteLLM.

## Ports / networking

In `docker-compose.yml`:

- LiteLLM listens on container port `4000` and is published to host port `4100` (`4100:4000`).
- LiteLLM calls the inference server via `host.docker.internal:8000` (host network gateway).

## Important environment variables

See `docker-compose.yml` and `.env.example`:

- `LITELLM_MASTER_KEY`: bearer token LiteLLM expects for admin/auth.
- `INFERENCE_API_BASE`: where LiteLLM forwards to (default points at host `:8000/v1`).
- `INFERENCE_API_KEY`: auth token LiteLLM uses when calling inference (placeholder by default).

## Timeouts / retries

`config/litellm.yaml` is tuned for long-running inference:

- Per-model: `stream_timeout: 600`, `timeout: 600`
- Router: `timeout: 600`, `num_retries: 3`
- `litellm_settings.request_timeout: 600`

If the inference server is down or wedged, these long timeouts can translate into “nothing happens for minutes” unless the controller/UI surface better failure states.

