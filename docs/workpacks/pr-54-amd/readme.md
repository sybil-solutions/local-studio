<!-- CRITICAL -->
# PR #54 (Amd) — Task Pack Index

This directory contains the decomposed task files for the recovered upstream PR:

- PR: https://github.com/0xSero/vllm-studio/pull/54
- Branch recovered locally: `pr-54-amd`

## Task Files

1. `task-01-amd-rocm-platform-integration.md`
2. `task-02-cross-vendor-device-visibility.md`
3. `task-03-stt-controller-integration.md`
4. `task-04-tts-controller-integration.md`
5. `task-05-call-mode-hands-free-loop.md`
6. `task-06-image-generation-modality.md`
7. `task-07-runtime-telemetry-and-charting-ready-data-plane.md`
8. `task-08-jobs-orchestration-voice-turn.md`

## Recommended Execution Order

1) Task 01
2) Task 02
3) Task 07
4) Task 03
5) Task 04
6) Task 05
7) Task 06
8) Task 08

## Dependency Notes

- Task 01 is foundational for platform/runtime confidence.
- Task 02 ensures launch behavior is cross-vendor consistent.
- Task 07 provides shared telemetry contracts used by Tasks 03–08.
- Tasks 03 and 04 are prerequisites for Task 05.
- Task 08 consumes STT/TTS/LLM capabilities but can run with reduced input paths.
