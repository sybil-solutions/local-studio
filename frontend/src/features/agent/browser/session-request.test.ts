import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BROWSER_SESSION_HEADER } from "@shared/agent/browser-session";
import { browserSessionRequest } from "@/features/agent/browser/session-request";

describe("browser session requests", () => {
  test("does not create a stateful request without a focused session", () => {
    assert.equal(browserSessionRequest(null, "frame"), null);
  });

  test("replaces the canonical header when the focused session changes", () => {
    const first = browserSessionRequest("session-a", "navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const second = browserSessionRequest("session-b", "navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.input, "/api/agent/browser/navigate");
    assert.equal(new Headers(first.init.headers).get(BROWSER_SESSION_HEADER), "session-a");
    assert.equal(new Headers(second.init.headers).get(BROWSER_SESSION_HEADER), "session-b");
    assert.equal(new Headers(second.init.headers).get("Content-Type"), "application/json");
  });
});
