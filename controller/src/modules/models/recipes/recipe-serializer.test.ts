import { describe, expect, test } from "bun:test";

import { parseRecipe } from "./recipe-serializer";

const minimalRecipe = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "strict-boolean-recipe",
  name: "Strict Boolean Recipe",
  model_path: "/models/strict-boolean-recipe",
  ...overrides,
});

describe("parseRecipe boolean settings", () => {
  const fields = ["trust_remote_code", "enable_auto_tool_choice"] as const;
  const invalidValues: ReadonlyArray<unknown> = [null, "true", "false", 0, 1, [], {}];

  for (const field of fields) {
    test(`preserves JSON booleans for ${field}`, () => {
      expect(parseRecipe(minimalRecipe({ [field]: true }))[field]).toBe(true);
      expect(parseRecipe(minimalRecipe({ [field]: false }))[field]).toBe(false);
    });

    test(`rejects non-boolean values for ${field}`, () => {
      for (const value of invalidValues) {
        expect(() => parseRecipe(minimalRecipe({ [field]: value }))).toThrow(
          `Invalid ${field}`,
        );
      }
    });
  }

  test("preserves omitted-field defaults", () => {
    const recipe = parseRecipe(minimalRecipe());
    expect(recipe.trust_remote_code).toBe(
      process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"] !== "false",
    );
    expect(recipe.enable_auto_tool_choice).toBe(false);
  });

  test("preserves the disabled trust default", () => {
    const previous = process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"];
    process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"] = "false";
    try {
      expect(parseRecipe(minimalRecipe()).trust_remote_code).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"];
      } else {
        process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"] = previous;
      }
    }
  });
});
