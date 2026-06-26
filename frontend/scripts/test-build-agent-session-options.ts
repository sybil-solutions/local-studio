import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptions,
} from "../src/features/agent/pi-runtime-helpers";

test("buildAgentSessionOptions resolves SDK extensions, skills, and env injections", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-runtime-options-"));
  const timeoutExtension = path.join(root, "timeout.mjs");
  const agentPolicyExtension = path.join(root, "agent-policy.mjs");
  const browserExtension = path.join(root, "browser.mjs");
  const sitegeistExtension = path.join(root, "sitegeist-browser.mjs");
  const canvasExtension = path.join(root, "canvas.mjs");
  const planExtension = path.join(root, "plan.mjs");
  const mcpExtension = path.join(root, "mcp.mjs");
  const pluginRoot = path.join(root, "plugin");
  const pluginSkills = path.join(pluginRoot, "skills");
  const selectedSkill = path.join(root, "selected-skill");
  const browserSkill = path.join(root, "browser-skill");
  const sitegeistSkill = path.join(root, "sitegeist-browser-skill");
  const canvasSkill = path.join(root, "canvas-skill");
  const planSkill = path.join(root, "plan-skill");
  const mcpConfig = path.join(pluginRoot, ".mcp.json");
  const relayEnv = path.join(root, "sitegeist-relay.env");

  await Promise.all([
    mkdir(pluginSkills, { recursive: true }),
    mkdir(selectedSkill),
    mkdir(browserSkill),
    mkdir(sitegeistSkill),
    mkdir(canvasSkill),
    mkdir(planSkill),
  ]);
  await Promise.all(
    [
      timeoutExtension,
      agentPolicyExtension,
      browserExtension,
      sitegeistExtension,
      canvasExtension,
      planExtension,
      mcpExtension,
    ].map((filePath) =>
      writeFile(filePath, "export default function extensionFactory() {}\n", "utf8"),
    ),
  );
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: { demo: { command: "demo" } } }), "utf8");
  await writeFile(
    relayEnv,
    "SITEGEIST_RELAY_URL=http://127.0.0.1:7717\nSITEGEIST_RELAY_TOKEN=test-token\n",
    "utf8",
  );

  const previousEnv = {
    LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH: process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH,
    LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH: process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH,
    LOCAL_STUDIO_BROWSER_EXTENSION_PATH: process.env.LOCAL_STUDIO_BROWSER_EXTENSION_PATH,
    LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH:
      process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH,
    LOCAL_STUDIO_CANVAS_EXTENSION_PATH: process.env.LOCAL_STUDIO_CANVAS_EXTENSION_PATH,
    LOCAL_STUDIO_PLAN_EXTENSION_PATH: process.env.LOCAL_STUDIO_PLAN_EXTENSION_PATH,
    LOCAL_STUDIO_MCP_EXTENSION_PATH: process.env.LOCAL_STUDIO_MCP_EXTENSION_PATH,
    LOCAL_STUDIO_BROWSER_SKILL_PATH: process.env.LOCAL_STUDIO_BROWSER_SKILL_PATH,
    LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH:
      process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH,
    LOCAL_STUDIO_CANVAS_SKILL_PATH: process.env.LOCAL_STUDIO_CANVAS_SKILL_PATH,
    LOCAL_STUDIO_PLAN_SKILL_PATH: process.env.LOCAL_STUDIO_PLAN_SKILL_PATH,
    LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH: process.env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH,
  };
  Object.assign(process.env, {
    LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH: timeoutExtension,
    LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH: agentPolicyExtension,
    LOCAL_STUDIO_BROWSER_EXTENSION_PATH: browserExtension,
    LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH: sitegeistExtension,
    LOCAL_STUDIO_CANVAS_EXTENSION_PATH: canvasExtension,
    LOCAL_STUDIO_PLAN_EXTENSION_PATH: planExtension,
    LOCAL_STUDIO_MCP_EXTENSION_PATH: mcpExtension,
    LOCAL_STUDIO_BROWSER_SKILL_PATH: browserSkill,
    LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH: sitegeistSkill,
    LOCAL_STUDIO_CANVAS_SKILL_PATH: canvasSkill,
    LOCAL_STUDIO_PLAN_SKILL_PATH: planSkill,
    LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH: relayEnv,
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
    // of pre-imported factories. The six bundled extensions in this fixture
    // are: timeout, agent policy, mcp (since plugins[].mcpConfigPath exists),
    // browser, canvas, and plan (always loaded — the Plan panel is core).
    assert.equal(result.extensionPaths.length, 6);
    assert.deepEqual(result.extensionPaths.toSorted(), [
      agentPolicyExtension,
      browserExtension,
      canvasExtension,
      mcpExtension,
      planExtension,
      timeoutExtension,
    ]);
    assert.deepEqual(result.skills, [
      pluginSkills,
      selectedSkill,
      browserSkill,
      planSkill,
      canvasSkill,
    ]);
    assert.equal(result.envInjections.LOCAL_STUDIO_BROWSER_SESSION_ID, "browser-session");
    assert.equal(result.envInjections.LOCAL_STUDIO_FRONTEND_BASE, "http://127.0.0.1:3007");
    assert.match(result.envInjections.LOCAL_STUDIO_MCP_PLUGIN_CONFIGS, /demo/);

    const targetEnv = {} as NodeJS.ProcessEnv;
    applyRuntimeEnvInjections(result.envInjections, targetEnv);
    assert.equal(targetEnv.SITEGEIST_RELAY_SESSION_ID, "browser-session");

    const sitegeistResult = await buildAgentSessionOptions({
      options: {
        browserToolEnabled: true,
        browserBackend: "sitegeist",
        browserSessionId: "sitegeist-session",
      },
      processEnv: { ...process.env },
    });
    assert.deepEqual(sitegeistResult.extensionPaths.toSorted(), [
      agentPolicyExtension,
      planExtension,
      sitegeistExtension,
      timeoutExtension,
    ]);
    assert.deepEqual(sitegeistResult.skills, [sitegeistSkill, planSkill]);
    assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_SESSION_ID, "sitegeist-session");
    assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_URL, "http://127.0.0.1:7717");
    assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_TOKEN, "test-token");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
