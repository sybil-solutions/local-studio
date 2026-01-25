// CRITICAL
import { describe, it, expect, beforeEach } from "vitest";
import { RecipeStore } from "./recipe-store";
import type { Recipe } from "../types/models";
import { asRecipeId } from "../types/brand";

/**
 * Create a minimal test recipe with required fields.
 * @param overrides - Partial recipe properties to override defaults.
 * @returns Complete recipe object.
 */
const createTestRecipe = (overrides: Omit<Partial<Recipe>, "id"> & { id: string; name: string }): Recipe => ({
  id: asRecipeId(overrides.id),
  name: overrides.name,
  model_path: overrides.model_path ?? "/models/test",
  backend: overrides.backend ?? "vllm",
  env_vars: overrides.env_vars ?? null,
  tensor_parallel_size: overrides.tensor_parallel_size ?? 1,
  pipeline_parallel_size: overrides.pipeline_parallel_size ?? 1,
  max_model_len: overrides.max_model_len ?? 4096,
  gpu_memory_utilization: overrides.gpu_memory_utilization ?? 0.9,
  kv_cache_dtype: overrides.kv_cache_dtype ?? "auto",
  max_num_seqs: overrides.max_num_seqs ?? 256,
  trust_remote_code: overrides.trust_remote_code ?? true,
  tool_call_parser: overrides.tool_call_parser ?? null,
  reasoning_parser: overrides.reasoning_parser ?? null,
  enable_auto_tool_choice: overrides.enable_auto_tool_choice ?? false,
  quantization: overrides.quantization ?? null,
  dtype: overrides.dtype ?? null,
  host: overrides.host ?? "0.0.0.0",
  port: overrides.port ?? 8000,
  served_model_name: overrides.served_model_name ?? null,
  python_path: overrides.python_path ?? null,
  extra_args: overrides.extra_args ?? {},
  max_thinking_tokens: overrides.max_thinking_tokens ?? null,
  thinking_mode: overrides.thinking_mode ?? "disabled",
});

describe("RecipeStore", () => {
  let store: RecipeStore;

  beforeEach(() => {
    store = new RecipeStore(":memory:");
  });

  describe("save", () => {
    it("saves a new recipe", () => {
      const recipe = createTestRecipe({ id: "test-recipe", name: "Test Recipe" });

      store.save(recipe);
      const found = store.get(asRecipeId("test-recipe"));

      expect(found).toBeDefined();
      expect(found?.id).toBe("test-recipe");
      expect(found?.name).toBe("Test Recipe");
    });

    it("updates existing recipe", () => {
      const recipe = createTestRecipe({ id: "test-recipe", name: "Original Name" });
      store.save(recipe);

      const updated = createTestRecipe({ id: "test-recipe", name: "Updated Name" });
      store.save(updated);
      const found = store.get(asRecipeId("test-recipe"));

      expect(found?.name).toBe("Updated Name");
    });
  });

  describe("list", () => {
    it("returns empty array initially", () => {
      const recipes = store.list();
      expect(recipes).toEqual([]);
    });

    it("returns all recipes", () => {
      const recipe1 = createTestRecipe({ id: "recipe-1", name: "Recipe 1" });
      const recipe2 = createTestRecipe({ id: "recipe-2", name: "Recipe 2", backend: "sglang" });

      store.save(recipe1);
      store.save(recipe2);

      const recipes = store.list();
      expect(recipes).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("returns recipe by id", () => {
      const recipe = createTestRecipe({ id: "test-recipe", name: "Test Recipe" });
      store.save(recipe);
      const found = store.get(asRecipeId("test-recipe"));

      expect(found).toBeDefined();
      expect(found?.id).toBe("test-recipe");
    });

    it("returns null for non-existent recipe", () => {
      const found = store.get(asRecipeId("non-existent"));
      expect(found).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes existing recipe", () => {
      const recipe = createTestRecipe({ id: "test-recipe", name: "Test Recipe" });
      store.save(recipe);
      const deleted = store.delete(asRecipeId("test-recipe"));

      expect(deleted).toBe(true);
      expect(store.get(asRecipeId("test-recipe"))).toBeNull();
    });

    it("returns false for non-existent recipe", () => {
      const result = store.delete(asRecipeId("non-existent"));
      expect(result).toBe(false);
    });
  });
});
