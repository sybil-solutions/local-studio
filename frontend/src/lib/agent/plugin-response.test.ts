import { describe, expect, it } from "vitest";
import type { PluginRow } from "./plugin-discovery";
import { buildPluginsResponse } from "./plugin-response";

const plugin = (patch: Partial<PluginRow>): PluginRow => ({
  id: patch.name ?? "plugin",
  name: patch.name ?? "plugin",
  path: `/plugins/${patch.name ?? "plugin"}`,
  installed: true,
  enabled: true,
  ...patch,
});

describe("buildPluginsResponse", () => {
  it("returns only enabled plugins for composer/runtime selection by default", () => {
    const response = buildPluginsResponse([
      plugin({ name: "browser-use" }),
      plugin({ name: "computer-use", enabled: false }),
    ]);

    expect(response.plugins.map((row) => row.name)).toEqual(["browser-use"]);
    expect(response.validation.browserUseAvailable).toBe(true);
    expect(response.validation.computerUseAvailable).toBe(false);
  });

  it("can include disabled plugins for the settings registry without marking them available", () => {
    const response = buildPluginsResponse(
      [plugin({ name: "browser-use", enabled: false }), plugin({ name: "computer-use" })],
      { includeDisabled: true },
    );

    expect(response.plugins.map((row) => row.name)).toEqual(["browser-use", "computer-use"]);
    expect(response.validation.browserUseAvailable).toBe(false);
    expect(response.validation.computerUseAvailable).toBe(true);
  });
});
