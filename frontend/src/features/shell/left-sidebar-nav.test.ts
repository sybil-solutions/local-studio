import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isRouteActive, mobilePageTitle, tabs } from "./left-sidebar-nav";

describe("left sidebar navigation", () => {
  test("keeps automations in the primary workspace navigation", () => {
    assert.deepEqual(
      tabs.map((tab) => [tab.href, tab.label]),
      [
        ["/", "Status"],
        ["/agent", "Workbench"],
        ["/agent/automations", "Automations"],
        ["/configure", "Configure"],
        ["/usage", "Usage"],
      ],
    );
  });

  test("activates automations without also activating workbench", () => {
    assert.equal(isRouteActive("/agent/automations", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/automations?new=1", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/automations", "/agent"), false);
    assert.equal(isRouteActive("/agent/session-1", "/agent"), true);
  });

  test("uses the automations title on mobile", () => {
    assert.equal(mobilePageTitle("/agent/automations"), "Automations");
  });
});
