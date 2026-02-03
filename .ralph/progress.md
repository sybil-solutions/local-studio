# Ralph Progress

## Iteration 1
- Initialized Ralph state files.
- Added plan.md (Phase 0.4 pre-flight commit pending).
- Next: implement Phase 1.2 schema + route changes + tests.

## Iteration 2
- Implemented Pi agent runtime + controller SSE runs, removed AI SDK usage, updated frontend chat flow.
- Fixed CI failures (knip/depcheck, CodeRabbit placeholder, vitest no-tests handling, turbopack root).
- Created PR #31 and closed all other open PRs.
- Deployed backend to server (controller running new code) and rebuilt frontend.
- Verified API health + chat run SSE; abort returns not found when run ends immediately.
- Blocker: PR merge requires external approval.

## Iteration 3
- Identified tool call failures caused by INTELLECT-3 running with glm45 parser.
- Updated recipe tool_call_parser to hermes and relaunched vLLM on server.
- Added Hermes `<tool_call><function=...>` parsing in controller proxy + LiteLLM handler.
- Re-ran controller typecheck/tests and frontend lint/build.
- Prepared deployment for updated parsers and attachment pipeline.

## Iteration 4
- Switched Intellect-3 tool_call_parser to qwen3_xml and relaunched vLLM.
- Detected LiteLLM streaming dropping tool_calls; bypassed LiteLLM for streaming tool calls.
- Verified streaming tool_calls from vLLM and SSE tool execution events.

## Iteration 5
- Added controller stream recovery for malformed tool-call JSON parsing.
- Fixed frontend UUID generation fallback and removed crypto.randomUUID dependency.
- Eliminated /chat hydration mismatch by deferring sidebar layout state to mount.
- Rebuilt and redeployed frontend + restarted controller on server.
- Verified chat + agent plan tool calls in browser; hit API /health and /v1/models.

## Iteration 6
- Fixed config settings save by retrying unwritable files and ensuring writable targets.
- Added frontend container user mapping + documented UID/GID env for data writes.
- Rebuilt frontend, redeployed on server, and verified POST /api/settings updates data file.
- Re-ran controller lint/typecheck/tests and frontend lint/build.
- Confirmed API health + /v1/models responses.
