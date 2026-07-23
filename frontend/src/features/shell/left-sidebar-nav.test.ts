import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isRouteActive, mobilePageTitle, tabs } from "./left-sidebar-nav";

const desktopSidebar = readFileSync(new URL("./left-sidebar-desktop.tsx", import.meta.url), "utf8");

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

  test("keeps session history steppers compact", () => {
    assert.match(desktopSidebar, /HISTORY_STEPPER_CLASS[\s\S]*h-6 w-6/);
    assert.match(desktopSidebar, /ChevronLeft className="h-3 w-3"/);
    assert.match(desktopSidebar, /ChevronRight className="h-3 w-3"/);
  });
});
