# Voice Integration Notes

## STT Endpoint

Controller exposes OpenAI-compatible transcription endpoint:

- `POST /v1/audio/transcriptions`
- multipart form field `file` is required
- optional fields: `model`, `language`, `mode`, `replace`

Response shape:

```json
{ "text": "..." }
```

## Model Resolution

Controller resolves STT model path in this order:

1. request `model`
2. `VLLM_STUDIO_STT_MODEL`

If the chosen model contains `/`, it is treated as a direct path.
Otherwise, it resolves to:

- `${VLLM_STUDIO_MODELS_DIR}/stt/<model>`

## Browser Upload Handling

Browser microphone captures (for example `audio/webm`) are accepted.
When non-WAV input is uploaded, controller uses `ffmpeg` to convert to mono 16 kHz WAV before running STT.

If `ffmpeg` is unavailable, controller returns an actionable dependency error.

## Required Environment

- `VLLM_STUDIO_STT_CLI` (optional override for `whisper-cli`)
- `VLLM_STUDIO_STT_MODEL` (optional default model)
- `VLLM_STUDIO_MODELS_DIR` (model root)
- `VLLM_STUDIO_STT_BACKEND` (optional, defaults to `whispercpp`)

## Frontend Relay

`/api/voice/transcribe` resolves voice target as:

1. configured `voiceUrl`
2. fallback `backendUrl` (controller-local)

Model injection is only applied for external voice targets.
