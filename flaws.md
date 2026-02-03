<!-- CRITICAL -->
# Test Report (Flaws & Gaps)

## Test Coverage Performed
- Atlas reload of `http://localhost:3000/chat` (tab focused + reload).
- Local UI availability via `curl -sI http://localhost:3000/chat` (200 OK).
- Local UI `http://localhost:3001/chat` (connection failed).
- Production API: `GET https://<your-api-domain>/health` (success; inference ready).
- Production API: `GET https://<your-api-domain>/v1/models` (success; `intellect-3` present).
- Production API: `POST /v1/chat/completions` (non-streaming + streaming).

## Findings (Actionable)
1. `/v1/chat/completions` returns `reasoning_content` with `message.content: null` for `intellect-3` non-streaming responses.
   Impact: Some OpenAI clients expect `content` to be a string and may ignore `reasoning_content`.
   Evidence: Non-streaming response had `message.content: null` and `reasoning_content` populated.

2. Local UI on `http://localhost:3001/chat` is not reachable.
   Impact: If 3001 is expected to host UI, it is currently down.
   Evidence: `curl` connection refused on port 3001.

3. Local controller not reachable on `http://localhost:8080`.
   Impact: Local API testing (OpenAI compatibility, health, tool calls) could not be performed.
   Evidence: `curl` to `localhost:8080/v1/models` failed to connect.

4. Docker daemon not running on the local machine.
   Impact: Required `docker compose up -d --build frontend` could not be executed.
   Evidence: Docker compose failed with “Cannot connect to the Docker daemon”.

## Gaps / Not Fully Verified
- Full UI interaction testing (compose/send, tool calls, agent plan drawer, artifacts, files panel).
  Reason: Atlas control does not provide DOM visibility or automation hooks in this environment.
- Agent tool execution paths end-to-end (requires controller + inference + MCP servers running).
- `/v1/chat/completions` streaming with tool calls (only a basic probe was attempted).
- Full UI interaction testing (compose/send, tool calls, agent plan drawer, artifacts, files panel).

## Recommendations
- Confirm controller and inference services are running locally on `:8080`/`:8000` for full QA.
- Consider normalizing `reasoning_content` into `message.content` for OpenAI-compatible clients.
- Re-test production `/v1/chat/completions` with tool calls and client compatibility.
- Run the frontend docker rebuild once Docker is available.
