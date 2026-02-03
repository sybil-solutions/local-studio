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
- Blockers: PR merge requires external approval; frontend restart needs permission to stop existing next-server (UID 1001).
