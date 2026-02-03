# Environment + API Keys

## Primary .env file
- Copy `.env.example` to `.env` at repo root.
- Keep `.env` out of git.

## Controller settings (required)
- `VLLM_STUDIO_HOST` (default `0.0.0.0`)
- `VLLM_STUDIO_PORT` (default `8080`)
- `VLLM_STUDIO_INFERENCE_PORT` (default `8000`)
- `VLLM_STUDIO_DATA_DIR` (default `./data`)
- `VLLM_STUDIO_MODELS_DIR` (default `/models`)

## Auth + gateway keys
- `VLLM_STUDIO_API_KEY` optional controller auth.
- `LITELLM_MASTER_KEY` required for LiteLLM proxy.
- `INFERENCE_API_BASE` points to inference server (usually `http://localhost:8000/v1`).
- `INFERENCE_API_KEY` optional upstream key for inference.

## Frontend settings
- `NEXT_PUBLIC_LITELLM_URL` (defaults to `http://localhost:4100`).
- `API_KEY` / `VLLM_STUDIO_API_KEY` in frontend container for proxy auth.
- `EXA_API_KEY` optional web search.
- `RAG_ENDPOINT` optional RAG service.

## Where these are used
- `controller/src/config/env.ts` parses controller settings.
- `docker-compose.yml` wires LiteLLM and frontend env.
- `frontend/.env.example` shows frontend-only values.
