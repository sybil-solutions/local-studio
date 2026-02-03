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
