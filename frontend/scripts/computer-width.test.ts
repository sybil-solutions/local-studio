import assert from "node:assert/strict";
import test from "node:test";
import { computerSnapWidths, computerWidthBounds } from "../src/features/agent/tools/persistence";

test("computer panel leaves half of the workspace available to the main pane", () => {
  assert.deepEqual(computerWidthBounds(1200), { min: 300, max: 600 });
  assert.deepEqual(computerSnapWidths(1200), [300, 420, 600]);
});
