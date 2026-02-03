# Ralph State

- iteration: 3
- task: "Phase 2: Fix Hermes tool calls, deploy, and verify end-to-end chat"
- completion_criteria:
  - Hermes tool call parsing enabled (proxy + LiteLLM handler)
  - Intellect-3 tool_call_parser set to hermes and model relaunched
  - Backend deployed on server with new parsers
  - Frontend rebuilt and restarted on :3000
  - Tool calls resolve with valid names + args in SSE runs
