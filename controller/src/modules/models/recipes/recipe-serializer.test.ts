import { describe, expect, test } from "bun:test";

import { parseRecipe } from "./recipe-serializer";
import { asRecipeId } from "../types";

const minimalRecipe = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "my-recipe",
  name: "My Recipe",
  model_path: "/models/my-model",
  ...over,
});

describe("parseRecipe id validation", () => {
  test("accepts a non-empty id", () => {
    const recipe = parseRecipe(minimalRecipe());
    expect(recipe.id).toBe(asRecipeId("my-recipe"));
  });

  test("rejects an empty id (would create an unaddressable ghost recipe)", () => {
    expect(() => parseRecipe(minimalRecipe({ id: "" }))).toThrow();
  });
});
