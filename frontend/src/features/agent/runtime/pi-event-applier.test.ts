import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceSessionEvent, type SessionStreamContext } from "./pi-event-applier";
import type { Session } from "./types";

const session = (): Session => ({
  id: "session-1",
  piSessionId: null,
  title: "",
  messages: [],
  status: "running",
  error: "",
  input: "",
});

const context = (): SessionStreamContext => ({ liveAssistantIds: new Map() });

test("extension UI requests become bounded browser dialogs", () => {
  const next = reduceSessionEvent(session(), context(), {
    type: "extension_ui_request",
    requestId: "request-1",
    method: "confirm",
    title: "Approve action",
    message: "Continue?",
  });
  assert.deepEqual(next.extensionUiRequest, {
    requestId: "request-1",
    method: "confirm",
    title: "Approve action",
    message: "Continue?",
  });
});

test("malformed extension UI requests are ignored", () => {
  const current = session();
  const next = reduceSessionEvent(current, context(), {
    type: "extension_ui_request",
    requestId: "request-1",
    method: "custom",
    title: "Unsupported",
  });
  assert.equal(next, current);
});
