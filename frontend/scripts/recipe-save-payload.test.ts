import assert from "node:assert/strict";
import test from "node:test";
import { prepareRecipeForSave } from "@/features/recipes/prepare-recipe";
import { DEFAULT_RECIPE } from "@/features/recipes/recipes-content/default-recipe";

test("recipe save payload excludes runtime-only state", () => {
  const recipe = {
    ...DEFAULT_RECIPE,
    name: "Renamed Serve",
    status: "error",
    crash_loop: {
      recipe_id: DEFAULT_RECIPE.id,
      failure_count: 3,
      limit: 3,
      window_ms: 60_000,
      reset_at: "2026-07-10T00:00:00.000Z",
      blocked: true,
    },
    extra_args: {
      metadata: { family: "test" },
      status: "stopped",
      crash_loop: { blocked: false },
    },
  };
  const payload = prepareRecipeForSave(recipe);

  assert.equal(payload.name, "Renamed Serve");
  assert.equal(Reflect.has(payload, "status"), false);
  assert.equal(Reflect.has(payload, "crash_loop"), false);
  assert.deepEqual(payload.extra_args, { metadata: { family: "test" } });
});
