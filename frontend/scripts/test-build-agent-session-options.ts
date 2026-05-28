import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptions,
} from "../src/lib/agent/pi-runtime-helpers";

test("buildAgentSessionOptions resolves SDK extensions, skills, and env injections", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-runtime-options-"));
  const timeoutExtension = path.join(root, "timeout.mjs");
  const browserExtension = path.join(root, "browser.mjs");
  const canvasExtension = path.join(root, "canvas.mjs");
  const mcpExtension = path.join(root, "mcp.mjs");
  const pluginRoot = path.join(root, "plugin");
  const pluginSkills = path.join(pluginRoot, "skills");
  const selectedSkill = path.join(root, "selected-skill");
  const browserSkill = path.join(root, "browser-skill");
  const canvasSkill = path.join(root, "canvas-skill");
  const mcpConfig = path.join(pluginRoot, ".mcp.json");

  await Promise.all([
    mkdir(pluginSkills, { recursive: true }),
    mkdir(selectedSkill),
    mkdir(browserSkill),
    mkdir(canvasSkill),
  ]);
  await Promise.all(
    [timeoutExtension, browserExtension, canvasExtension, mcpExtension].map((filePath) =>
      writeFile(filePath, "export default function extensionFactory() {}\n", "utf8"),
    ),
  );
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: { demo: { command: "demo" } } }), "utf8");

  const previousEnv = {
    VLLM_STUDIO_TIMEOUT_EXTENSION_PATH: process.env.VLLM_STUDIO_TIMEOUT_EXTENSION_PATH,
    VLLM_STUDIO_BROWSER_EXTENSION_PATH: process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH,
    VLLM_STUDIO_CANVAS_EXTENSION_PATH: process.env.VLLM_STUDIO_CANVAS_EXTENSION_PATH,
    VLLM_STUDIO_MCP_EXTENSION_PATH: process.env.VLLM_STUDIO_MCP_EXTENSION_PATH,
    VLLM_STUDIO_BROWSER_SKILL_PATH: process.env.VLLM_STUDIO_BROWSER_SKILL_PATH,
    VLLM_STUDIO_CANVAS_SKILL_PATH: process.env.VLLM_STUDIO_CANVAS_SKILL_PATH,
  };
  Object.assign(process.env, {
    VLLM_STUDIO_TIMEOUT_EXTENSION_PATH: timeoutExtension,
    VLLM_STUDIO_BROWSER_EXTENSION_PATH: browserExtension,
    VLLM_STUDIO_CANVAS_EXTENSION_PATH: canvasExtension,
    VLLM_STUDIO_MCP_EXTENSION_PATH: mcpExtension,
    VLLM_STUDIO_BROWSER_SKILL_PATH: browserSkill,
    VLLM_STUDIO_CANVAS_SKILL_PATH: canvasSkill,
  });

  try {
    const result = await buildAgentSessionOptions({
      options: {
        browserToolEnabled: true,
        browserSessionId: "browser-session",
        canvasEnabled: true,
        plugins: [{ name: "demo", path: pluginRoot, mcpConfigPath: mcpConfig }],
        skills: [
          { name: "selected", path: selectedSkill },
          { name: "dupe", path: selectedSkill },
        ],
      },
      processEnv: { ...process.env, PORT: "3007" },
    });

    // SDK loads .ts/.js extensions via jiti; we hand it absolute paths instead
    // of pre-imported factories. The four bundled extensions in this fixture
    // are: timeout, mcp (since plugins[].mcpConfigPath exists), browser,
    // canvas.
    assert.equal(result.extensionPaths.length, 4);
    assert.deepEqual(result.extensionPaths.toSorted(), [
      browserExtension,
      canvasExtension,
      mcpExtension,
      timeoutExtension,
    ]);
    assert.deepEqual(result.skills, [pluginSkills, selectedSkill, browserSkill, canvasSkill]);
    assert.equal(result.envInjections.VLLM_STUDIO_BROWSER_SESSION_ID, "browser-session");
    assert.equal(result.envInjections.VLLM_STUDIO_FRONTEND_BASE, "http://127.0.0.1:3007");
    assert.equal(result.envInjections.PARCHI_RELAY_ORIGIN, "http://127.0.0.1:3007");
    assert.match(result.envInjections.VLLM_STUDIO_MCP_PLUGIN_CONFIGS, /demo/);

    const targetEnv = {} as NodeJS.ProcessEnv;
    applyRuntimeEnvInjections(result.envInjections, targetEnv);
    assert.equal(targetEnv.PARCHI_RELAY_SESSION_ID, "browser-session");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
