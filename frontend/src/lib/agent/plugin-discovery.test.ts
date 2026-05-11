import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __resetDataDirCacheForTests } from "@/lib/data-dir";
import {
  codexAppPluginRoots,
  codexPluginCacheRoots,
  discoverPlugins,
  loadPluginInstructions,
} from "./plugin-discovery";

describe("Codex plugin roots", () => {
  it("includes bundled app and Codex cache plugin locations without requiring config.toml", () => {
    expect(codexPluginCacheRoots("/home/test")).toEqual(
      expect.arrayContaining([
        "/home/test/.codex/plugins/cache/openai-bundled",
        "/home/test/.codex/plugins/cache/openai-bundled/plugins",
        "/home/test/.codex/plugins/cache/openai-curated",
        "/home/test/.codex/plugins/cache/openai-primary-runtime",
      ]),
    );
    expect(codexAppPluginRoots()).toEqual(
      expect.arrayContaining([
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled",
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins",
      ]),
    );
  });
});

describe("discoverPlugins", () => {
  it("finds Codex cache plugins below owner/name/version/skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const plugin = path.join(root, "cache", "openai-bundled", "computer-use", "1.0.0");
      mkdirSync(path.join(plugin, "skills"), { recursive: true });

      expect(discoverPlugins([root])).toEqual([
        {
          id: plugin,
          name: "computer-use",
          path: plugin,
          installed: true,
          enabled: true,
          source: "openai-bundled",
          skillPath: path.join(plugin, "skills"),
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds direct plugin manifests and keeps rows deterministic", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const direct = path.join(root, "z-plugin");
      const manifest = path.join(root, "a-plugin");
      mkdirSync(direct, { recursive: true });
      mkdirSync(manifest, { recursive: true });
      writeFileSync(path.join(direct, "plugin.toml"), "name = 'z-plugin'\n");
      writeFileSync(path.join(manifest, ".codex-plugin.toml"), "name = 'a-plugin'\n");

      expect(discoverPlugins([root]).map((row) => row.name)).toEqual(["a-plugin", "z-plugin"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads modern .codex-plugin/plugin.json manifests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const plugin = path.join(root, "cache", "openai-bundled", "browser-use", "0.1.0");
      mkdirSync(path.join(plugin, ".codex-plugin"), { recursive: true });
      writeFileSync(
        path.join(plugin, ".codex-plugin", "plugin.json"),
        '{"name":"browser-use","description":"Browser automation"}',
      );

      expect(discoverPlugins([root])).toEqual([
        {
          id: plugin,
          name: "browser-use",
          path: plugin,
          installed: true,
          enabled: true,
          description: "Browser automation",
          source: "openai-bundled",
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps same-name plugins from different marketplaces separate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const first = path.join(root, "openai-bundled", "plugins", "browser-use");
      const second = path.join(root, "local-market", "plugins", "browser-use");
      mkdirSync(path.join(first, ".codex-plugin"), { recursive: true });
      mkdirSync(path.join(second, ".codex-plugin"), { recursive: true });
      writeFileSync(path.join(first, ".codex-plugin", "plugin.json"), '{"name":"browser-use"}');
      writeFileSync(path.join(second, ".codex-plugin", "plugin.json"), '{"name":"browser-use"}');

      expect(discoverPlugins([root]).map((row) => `${row.name}@${row.source ?? "local"}`)).toEqual([
        "browser-use@local",
        "browser-use@openai-bundled",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the newest same-marketplace plugin instead of root traversal order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const oldPlugin = path.join(root, "cache", "openai-bundled", "browser-use", "0.1.0");
      const newPlugin = path.join(root, "app", "openai-bundled", "plugins", "browser-use");
      mkdirSync(path.join(oldPlugin, ".codex-plugin"), { recursive: true });
      mkdirSync(path.join(newPlugin, ".codex-plugin"), { recursive: true });
      writeFileSync(
        path.join(oldPlugin, ".codex-plugin", "plugin.json"),
        '{"name":"browser-use","version":"0.1.0-alpha1"}',
      );
      writeFileSync(
        path.join(newPlugin, ".codex-plugin", "plugin.json"),
        '{"name":"browser-use","version":"0.1.0-alpha2"}',
      );

      expect(discoverPlugins([newPlugin, oldPlugin])).toEqual([
        expect.objectContaining({
          name: "browser-use",
          version: "0.1.0-alpha2",
          path: newPlugin,
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hydrates Codex interface metadata and enabled state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const marketplace = path.join(root, "openai-bundled");
      const plugin = path.join(marketplace, "plugins", "computer-use");
      const config = path.join(root, "config.toml");
      mkdirSync(path.join(plugin, ".codex-plugin"), { recursive: true });
      mkdirSync(path.join(plugin, "plugin-skills"), { recursive: true });
      writeFileSync(path.join(plugin, "plugin-mcp.json"), '{"mcpServers":{}}');
      writeFileSync(
        path.join(plugin, "plugin-app.json"),
        '{"apps":{"computer-use":{"id":"connector_computer"}}}',
      );
      writeFileSync(
        path.join(plugin, ".codex-plugin", "plugin.json"),
        JSON.stringify({
          name: "computer-use",
          version: "1.0.780",
          description: "Control desktop apps.",
          skills: "./plugin-skills",
          mcpServers: "./plugin-mcp.json",
          apps: "./plugin-app.json",
          interface: {
            displayName: "Computer Use",
            shortDescription: "Control Mac apps",
            category: "Productivity",
            capabilities: ["Interactive", "Read"],
            defaultPrompt: "Play Chess.app",
            brandColor: "#0F172A",
          },
        }),
      );
      writeFileSync(
        config,
        `[marketplaces.openai-bundled]\nsource = "${marketplace}"\n\n[plugins."computer-use@openai-bundled"]\nenabled = false\n`,
      );

      expect(discoverPlugins([path.join(marketplace, "plugins")], { configPath: config })).toEqual([
        expect.objectContaining({
          name: "computer-use",
          displayName: "Computer Use",
          version: "1.0.780",
          enabled: false,
          source: "openai-bundled",
          shortDescription: "Control Mac apps",
          category: "Productivity",
          capabilities: ["Interactive", "Read"],
          defaultPrompts: ["Play Chess.app"],
          brandColor: "#0F172A",
          skillPath: path.join(plugin, "plugin-skills"),
          mcpConfigPath: path.join(plugin, "plugin-mcp.json"),
          appConfigPath: path.join(plugin, "plugin-app.json"),
          appIds: ["connector_computer"],
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads selected plugin skill instructions from trusted plugin roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    try {
      const plugin = path.join(root, "openai-bundled", "plugins", "browser-use");
      const skill = path.join(plugin, "skills", "browser");
      mkdirSync(path.join(plugin, ".codex-plugin"), { recursive: true });
      mkdirSync(skill, { recursive: true });
      writeFileSync(
        path.join(plugin, ".codex-plugin", "plugin.json"),
        '{"name":"browser-use","skills":"./skills"}',
      );
      writeFileSync(path.join(skill, "SKILL.md"), "# Browser\nUse the in-app browser.");

      expect(loadPluginInstructions(plugin, [path.join(root, "openai-bundled")])).toMatchObject({
        name: "browser-use",
        instructions: "# Browser\nUse the in-app browser.",
      });
      expect(loadPluginInstructions(path.join(root, "outside"), [plugin])).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers a local re-signed Computer Use helper over the bundled launch-constrained app", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-plugin-discovery-"));
    const previousDataDir = process.env.VLLM_STUDIO_DATA_DIR;
    try {
      const dataDir = path.join(root, "data");
      process.env.VLLM_STUDIO_DATA_DIR = dataDir;
      __resetDataDirCacheForTests();

      const localHelper = path.join(dataDir, "computer-use");
      mkdirSync(path.join(localHelper, "Codex Computer Use.app"), { recursive: true });
      writeFileSync(path.join(localHelper, ".mcp.json"), '{"mcpServers":{}}');

      const bundled = path.join(root, "openai-bundled", "plugins", "computer-use");
      mkdirSync(path.join(bundled, ".codex-plugin"), { recursive: true });
      writeFileSync(
        path.join(bundled, ".codex-plugin", "plugin.json"),
        '{"name":"computer-use","version":"9.9.9"}',
      );

      const rows = discoverPlugins([bundled, path.join(homedir(), ".codex", "plugins")], {
        maxDepth: 0,
      });

      expect(rows.find((row) => row.name === "computer-use")).toMatchObject({
        path: localHelper,
        appPath: path.join(localHelper, "Codex Computer Use.app"),
        mcpConfigPath: path.join(localHelper, ".mcp.json"),
      });
    } finally {
      if (previousDataDir === undefined) delete process.env.VLLM_STUDIO_DATA_DIR;
      else process.env.VLLM_STUDIO_DATA_DIR = previousDataDir;
      __resetDataDirCacheForTests();
      await rm(root, { recursive: true, force: true });
    }
  });
});
