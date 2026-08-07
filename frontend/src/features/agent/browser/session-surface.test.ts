import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserSessionSurface } from "@/features/agent/browser/session-surface";

test("switching sessions aborts old traffic without replaying the inherited URL", () => {
  const surface = new BrowserSessionSurface();
  surface.enterSession("session-a", "https://a.example");
  const frameA = surface.requestController("session-a");
  const navigationA = surface.requestController("session-a");
  assert.ok(frameA);
  assert.ok(navigationA);
  surface.observeServerUrl("session-a", "https://a.example");
  assert.equal(surface.syncViewport("session-a", { height: 600, width: 800 }), true);
  assert.equal(surface.syncViewport("session-a", { height: 600, width: 800 }), false);

  surface.enterSession("session-b", "https://a.example");

  assert.equal(frameA.signal.aborted, true);
  assert.equal(navigationA.signal.aborted, true);
  assert.equal(surface.requestController("session-a"), null);
  assert.equal(surface.navigationTarget("session-b", "https://a.example"), null);
  assert.equal(surface.syncViewport("session-b", { height: 600, width: 800 }), true);
  assert.deepEqual(surface.viewport(), { height: 600, width: 800 });

  surface.observeServerUrl("session-b", "https://b.example");
  assert.equal(surface.navigationTarget("session-b", "https://b.example"), null);
  assert.equal(
    surface.navigationTarget("session-b", "https://next.example"),
    "https://next.example",
  );
});
