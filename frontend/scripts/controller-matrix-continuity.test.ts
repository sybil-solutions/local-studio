import assert from "node:assert/strict";
import test from "node:test";
import { controllerSnapshotAfterFailure } from "../src/features/dashboard/control-panel/controller-matrix-store";

const controller = { url: "http://controller:8080", name: "Rig" };
const previous = {
  ...controller,
  index: 0,
  primary: true,
  online: true,
  authRequired: false,
  running: true,
  modelName: "glm-5.2",
  nodeCount: 2,
  cpu: "AMD EPYC · 48 cores",
  memoryGb: 504,
};

test("transient poll failures retain controller state", () => {
  const next = controllerSnapshotAfterFailure({
    authRequired: false,
    controller,
    failureStreak: 1,
    index: 0,
    previous,
  });
  assert.equal(next.online, true);
  assert.equal(next.running, true);
  assert.equal(next.modelName, "glm-5.2");
  assert.equal(next.nodeCount, 2);
  assert.equal(next.memoryGb, 504);
});

test("sustained failures mark offline without dropping model details", () => {
  const next = controllerSnapshotAfterFailure({
    authRequired: false,
    controller,
    failureStreak: 4,
    index: 0,
    previous,
  });
  assert.equal(next.online, false);
  assert.equal(next.running, false);
  assert.equal(next.modelName, "glm-5.2");
});

test("authentication failures surface immediately", () => {
  const next = controllerSnapshotAfterFailure({
    authRequired: true,
    controller,
    failureStreak: 1,
    index: 0,
    previous,
  });
  assert.equal(next.authRequired, true);
  assert.equal(next.online, false);
});
