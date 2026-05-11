import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __resetDataDirCacheForTests } from "@/lib/data-dir";
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

  it("recognizes core plugin availability from display metadata case-insensitively", () => {
    const response = buildPluginsResponse([
      plugin({ id: "browser", name: "BrowserUse", displayName: "Browser-Use" }),
      plugin({ id: "computer", name: "ComputerUse", displayName: "Computer-Use" }),
    ]);

    expect(response.validation.browserUseAvailable).toBe(true);
    expect(response.validation.computerUseAvailable).toBe(true);
  });

  it("reports runtime resource checks for MCP-backed plugins", () => {
    const root = mkdtempSync(path.join(tmpdir(), "plugin-response-"));
    mkdirSync(path.join(root, "bin"));
    writeFileSync(path.join(root, "bin", "server"), "#!/bin/sh\n");
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { demo: { command: "./bin/server", cwd: "." } } }),
    );

    const response = buildPluginsResponse([
      plugin({
        name: "computer-use",
        path: root,
        mcpConfigPath: path.join(root, ".mcp.json"),
        appPath: root,
      }),
    ]);

    expect(response.validation.computerUseRuntime).toMatchObject({
      mcpConfigured: true,
      appConfigured: true,
      mcpExecutableExists: true,
      runtimeCheckRequired: true,
    });
    expect(response.validation.computerUseRuntime?.note).toContain("mcp_plugin_status");
  });

  it("reports Codex Computer Use launch constraints truthfully", () => {
    const root = mkdtempSync(path.join(tmpdir(), "plugin-response-"));
    mkdirSync(path.join(root, "Codex Computer Use.app", "Contents", "SharedSupport"), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "computer-use": {
            command:
              "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
            args: ["mcp"],
            cwd: ".",
          },
        },
      }),
    );

    const response = buildPluginsResponse([
      plugin({ name: "computer-use", path: root, mcpConfigPath: path.join(root, ".mcp.json") }),
    ]);

    expect(response.validation.computerUseRuntime).toMatchObject({
      runtimeBlockedOutsideCodex: true,
      runtimeCheckRequired: true,
    });
    expect(response.validation.computerUseRuntime?.note).toContain("launch-constrained");
  });

  it("does not mark the local Computer Use helper as blocked outside Codex", () => {
    const root = mkdtempSync(path.join(tmpdir(), "plugin-response-"));
    const previousDataDir = process.env.VLLM_STUDIO_DATA_DIR;
    try {
      process.env.VLLM_STUDIO_DATA_DIR = root;
      __resetDataDirCacheForTests();
      const helper = path.join(root, "computer-use");
      mkdirSync(
        path.join(
          helper,
          "Codex Computer Use.app",
          "Contents",
          "SharedSupport",
          "SkyComputerUseClient.app",
          "Contents",
          "MacOS",
        ),
        { recursive: true },
      );
      const executable = path.join(
        helper,
        "Codex Computer Use.app",
        "Contents",
        "SharedSupport",
        "SkyComputerUseClient.app",
        "Contents",
        "MacOS",
        "SkyComputerUseClient",
      );
      writeFileSync(executable, "#!/bin/sh\n");
      writeFileSync(
        path.join(helper, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "computer-use": {
              command:
                "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
              args: ["mcp"],
              cwd: ".",
            },
          },
        }),
      );

      const response = buildPluginsResponse([
        plugin({
          name: "computer-use",
          path: helper,
          appPath: path.join(helper, "Codex Computer Use.app"),
          mcpConfigPath: path.join(helper, ".mcp.json"),
        }),
      ]);

      expect(response.validation.computerUseRuntime).toMatchObject({
        mcpConfigured: true,
        appConfigured: true,
        mcpExecutableExists: true,
        runtimeCheckRequired: true,
      });
      expect(response.validation.computerUseRuntime?.runtimeBlockedOutsideCodex).toBeUndefined();
    } finally {
      if (previousDataDir === undefined) delete process.env.VLLM_STUDIO_DATA_DIR;
      else process.env.VLLM_STUDIO_DATA_DIR = previousDataDir;
      __resetDataDirCacheForTests();
    }
  });

  it("marks MCP runtime incomplete when any configured server executable is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "plugin-response-"));
    mkdirSync(path.join(root, "bin"));
    writeFileSync(path.join(root, "bin", "server"), "#!/bin/sh\n");
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          ready: { command: "./bin/server", cwd: "." },
          missing: { command: "./bin/missing", cwd: "." },
        },
      }),
    );

    const response = buildPluginsResponse([
      plugin({ name: "computer-use", path: root, mcpConfigPath: path.join(root, ".mcp.json") }),
    ]);

    expect(response.validation.computerUseRuntime).toMatchObject({
      mcpConfigured: true,
      mcpExecutableExists: false,
    });
  });
});
