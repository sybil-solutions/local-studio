import assert from "node:assert/strict";
import test from "node:test";

import { computerPanelVisibility } from "../src/features/agent/tools/persistence";
import type { ComputerState } from "../src/features/agent/tools/types";

const panel: ComputerState = {
  open: true,
  tab: "side-chat",
  tabs: ["status", "side-chat", "browser"],
  width: 440,
  canvasEnabled: false,
  canvasText: "",
};

test("hiding the right panel preserves its selected tab and open tab identities", () => {
  const hidden = computerPanelVisibility(panel, false);

  assert.equal(hidden.open, false);
  assert.equal(hidden.tab, "side-chat");
  assert.deepEqual(hidden.tabs, ["status", "side-chat", "browser"]);
});

test("showing the right panel repairs an empty tab list without changing its content", () => {
  const shown = computerPanelVisibility({ ...panel, open: false, tabs: [] }, true);

  assert.equal(shown.open, true);
  assert.equal(shown.tab, "side-chat");
  assert.deepEqual(shown.tabs, ["status"]);
  assert.equal(shown.width, 440);
});

test("an unchanged visibility request preserves state identity", () => {
  assert.equal(computerPanelVisibility(panel, true), panel);
});
