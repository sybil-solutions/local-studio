import assert from "node:assert/strict";
import test from "node:test";

import { buildReadinessMatrixRows } from "@/features/dashboard/readiness-matrix/readiness-matrix-model";
import type { RecipeWithStatus } from "@/lib/types";

function recipe(overrides: Partial<RecipeWithStatus> = {}): RecipeWithStatus {
  return {
    id: "recipe-1",
    name: "Test Recipe",
    model_path: "/models/test.gguf",
    backend: "llamacpp",
    status: "stopped",
    ...overrides,
  } as RecipeWithStatus;
}

test("empty recipe list returns empty rows", () => {
  const rows = buildReadinessMatrixRows([], null, null, "idle");
  assert.deepEqual(rows, []);
});

test("stopped recipe is configured but not served or selected", () => {
  const rows = buildReadinessMatrixRows([recipe()], null, null, "idle");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].configured, true);
  assert.equal(rows[0].processState, "stopped");
  assert.equal(rows[0].served, false);
  assert.equal(rows[0].selected, false);
  assert.equal(rows[0].mismatch, false);
});

test("current running recipe with matching served model is ready", () => {
  const r = recipe({ status: "running", served_model_name: "served-model" });
  const rows = buildReadinessMatrixRows([r], r, "served-model", "ready");
  assert.equal(rows[0].processState, "running");
  assert.equal(rows[0].served, true);
  assert.equal(rows[0].selected, true);
  assert.equal(rows[0].mismatch, false);
});

test("selected running recipe without matching served model shows mismatch", () => {
  const r = recipe({ status: "running", served_model_name: "served-model" });
  const rows = buildReadinessMatrixRows([r], r, "other-model", "ready");
  assert.equal(rows[0].served, false);
  assert.equal(rows[0].mismatch, true);
});

test("fallback to recipe id when served_model_name is absent", () => {
  const r = recipe({ status: "running" });
  const rows = buildReadinessMatrixRows([r], r, "recipe-1", "ready");
  assert.equal(rows[0].served, true);
  assert.equal(rows[0].mismatch, false);
});

test("lifecycleStatus starting overrides non-running selected recipe", () => {
  const r = recipe({ status: "stopped" });
  const rows = buildReadinessMatrixRows([r], r, null, "starting");
  assert.equal(rows[0].processState, "starting");
  assert.equal(rows[0].selected, true);
});

test("lifecycleStatus error overrides selected recipe", () => {
  const r = recipe({ status: "running" });
  const rows = buildReadinessMatrixRows([r], r, null, "error");
  assert.equal(rows[0].processState, "error");
  assert.equal(rows[0].mismatch, false);
});

test("non-selected recipes keep their own status", () => {
  const running = recipe({ id: "run", status: "running" });
  const stopped = recipe({ id: "stop", status: "stopped" });
  const rows = buildReadinessMatrixRows([running, stopped], running, "run", "ready");
  assert.equal(rows[0].selected, true);
  assert.equal(rows[1].selected, false);
  assert.equal(rows[1].processState, "stopped");
});
