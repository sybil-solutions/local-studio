import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isRouteActive, mobilePageTitle, tabs } from "./left-sidebar-nav";

const desktopSidebar = readFileSync(new URL("./left-sidebar-desktop.tsx", import.meta.url), "utf8");

describe("left sidebar navigation", () => {
  test("keeps sessions and automations in the primary workspace navigation", () => {
    assert.deepEqual(
      tabs.map((tab) => [tab.href, tab.label]),
      [
        ["/", "Status"],
        ["/agent", "Workbench"],
        ["/agent/sessions", "Sessions"],
        ["/agent/automations", "Automations"],
        ["/configure", "Configure"],
        ["/usage", "Usage"],
      ],
    );
  });

  test("activates agent destinations independently", () => {
    assert.equal(isRouteActive("/agent/automations", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/automations?new=1", "/agent/automations"), true);
    assert.equal(isRouteActive("/agent/sessions", "/agent/sessions"), true);
    assert.equal(isRouteActive("/agent/automations", "/agent"), false);
    assert.equal(isRouteActive("/agent/sessions", "/agent"), false);
    assert.equal(isRouteActive("/agent/session-1", "/agent"), true);
  });

  test("uses destination titles on mobile", () => {
    assert.equal(mobilePageTitle("/agent/automations"), "Automations");
    assert.equal(mobilePageTitle("/agent/sessions"), "Sessions");
  });

  test("keeps session history steppers compact", () => {
    assert.match(desktopSidebar, /HISTORY_STEPPER_CLASS[\s\S]*h-6 w-6/);
    assert.match(desktopSidebar, /ChevronLeft className="h-3 w-3"/);
    assert.match(desktopSidebar, /ChevronRight className="h-3 w-3"/);
  });
});
