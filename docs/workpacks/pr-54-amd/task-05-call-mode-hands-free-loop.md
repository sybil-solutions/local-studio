<!-- CRITICAL -->
# Task 05 — Call Mode (Hands-Free STT → LLM → TTS Loop)

## 1) Task Intent

Implement an end-to-end conversational call mode where the app:

1. starts recording,
2. auto-stops on silence,
3. transcribes and auto-sends user speech,
4. receives assistant response,
5. speaks response via TTS,
6. automatically re-opens microphone for the next turn.

This task turns discrete voice primitives into a coherent interaction mode.

---

## 2) Why This Task Exists

STT and TTS alone are not enough for “call experience.” Users need minimal-click conversation flow. PR #54 includes a working prototype loop, but it requires task-level hardening and guardrails.

---

## 3) PR Evidence (Source Material)

- `frontend/src/app/chat/_components/input/tool-belt.tsx`
- `frontend/src/app/chat/_components/input/tool-belt-toolbar.tsx`
- `frontend/src/app/chat/_components/input/recording-indicator.tsx`
- `frontend/src/app/chat/_components/layout/chat-page/use-chat-page-controller.tsx`
- `frontend/src/store/chat-slice.ts`
- `frontend/src/store/chat-slice-types.ts`
- `frontend/tests/voice-call-mode-proof.spec.ts`

---

## 4) In Scope

### 4.1 UX Control Surface

- Add call-mode toggle in chat composer toolbar.
- Require selected model before call mode can be enabled.
- Show state-specific indicators: recording, transcribing, speaking.

### 4.2 Recording Lifecycle

- Start recording automatically when call mode toggles on.
- Auto-stop based on silence detection (when supported).
- Include max recording duration guard.
- Support manual stop fallback.

### 4.3 Transcript-to-Send Behavior

- In call mode, transcript auto-sends without manual submit.
- Add duplicate transcript suppression window to prevent accidental double sends.

### 4.4 Assistant Playback and Loop Continuation

- Speak newest assistant response (trimmed to practical length cap).
- After playback ends (or fails), re-open mic after short delay.

### 4.5 Deterministic E2E Path

- Provide fake-mic/test mode for CI where real microphone permissions/devices are unstable.

---

## 5) Out of Scope

- Full-duplex live voice (simultaneous talk/listen),
- barge-in interruption semantics,
- WebRTC transport,
- advanced VAD model tuning beyond baseline thresholds.

---

## 6) Functional Requirements

### FR-01: Toggle Guard

If no model is selected, enabling call mode must fail with user-visible guidance.

### FR-02: Auto-Start on Enable

On successful enable, recording begins immediately.

### FR-03: Hands-Free Turn Completion

When transcript is produced in call mode:

- submit immediately,
- clear composer/attachments as needed,
- avoid requiring explicit send click.

### FR-04: Playback-Reopen Loop

After assistant TTS playback completes (or playback fails), microphone restarts automatically if call mode is still enabled.

### FR-05: Failure Resilience

STT or TTS failures must not permanently deadlock call mode state; user can continue or disable mode safely.

### FR-06: Duplicate Prevention

Same transcript within short dedupe interval should not enqueue duplicate messages.

---

## 7) Non-Functional Requirements

- **Stability:** no runaway recursive loops on repeated failures.
- **Resource hygiene:** always release media tracks/audio contexts when recording stops.
- **Cross-browser robustness:** degrade gracefully if AudioContext/VAD path is blocked.

---

## 8) Detailed Implementation Plan

### 8.1 Composer + Toolbar

1. Add call mode state to chat store.
2. Add call mode toggle control and disabled states.
3. Add recording and transcription indicators.

### 8.2 Recorder Engine

1. Implement recorder state machine (`idle`, `recording`, `transcribing`, `error`).
2. Use MediaRecorder where available.
3. In call mode, attach volume monitor for silence stop:
   - min-record threshold,
   - silence timeout,
   - max-record timeout.
4. Provide fake recorder branch for deterministic test automation.

### 8.3 Submission Logic

1. Transcribe captured audio via `/api/voice/transcribe`.
2. In call mode, auto-submit transcript.
3. Apply dedupe check against last voice submission.

### 8.4 Assistant Playback Loop

1. Track latest assistant message already spoken in call mode.
2. Speak only new assistant content.
3. Reopen recording after playback end/error with small delay.

### 8.5 Cleanup Semantics

- On toggle off: abort transcription, stop recorder, stop playback.
- On component unmount: release media resources.

---

## 9) State and Event Contract

Minimum tracked state:

- `callModeEnabled`
- `isRecording`
- `isTranscribing`
- `recordingDuration`
- `speakingMessageId`

Transition examples:

- `enable_call_mode` → `recording`
- `recording_stopped` → `transcribing`
- `transcript_ready` → `sending`
- `assistant_done` → `tts_playback`
- `tts_ended` → `recording`

---

## 10) Test Plan

### 10.1 Unit/Component

- toggle enable/disable behavior,
- dedupe logic,
- stop/cleanup behavior,
- playback restart trigger.

### 10.2 Playwright E2E

- deterministic fake mic path,
- call mode auto-record and auto-stop,
- transcript appears as user message,
- listen/TTS action executes,
- recording resumes for next turn.

---

## 11) UX Constraints

- Must remain optional and explicit (no auto-enable),
- fallback manual controls always available,
- avoid overwhelming toasts; dedupe repeated errors.

---

## 12) Risks and Mitigations

- **Risk:** browser autoplay restrictions block TTS.
  - **Mitigation:** fallback continue loop + user toast.
- **Risk:** VAD sensitivity mismatch across microphones.
  - **Mitigation:** conservative thresholds + max timeout + manual stop.
- **Risk:** repeated failure loops.
  - **Mitigation:** bounded retries and explicit mode-off escape.

---

## 13) Definition of Done

- [ ] Call mode toggle and guard behavior implemented
- [ ] Hands-free voice turn loop works end-to-end
- [ ] Resource cleanup is verified in stop/unmount paths
- [ ] Deterministic E2E proof test is stable
- [ ] Lint/build/typecheck pass cleanly
