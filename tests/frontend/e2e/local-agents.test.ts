// E2E coverage for the "attach a model to local coding agents" core module.
// Every test builds a throwaway fake home dir under os.tmpdir(); the user's
// real ~/.pi / ~/.opencode / ~/.config/opencode / ~/.factory / ~/.hermes are never read
// or written.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  attachModelToAgents,
  detectLocalAgents,
  type LocalAgentModel,
} from "@/features/settings/local-agents";

const createdHomes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "local-studio-local-agents-"));
  createdHomes.push(home);
  return home;
}

after(() => {
  for (const home of createdHomes) rmSync(home, { recursive: true, force: true });
});

function makeModel(overrides: Partial<LocalAgentModel> = {}): LocalAgentModel {
  return {
    modelId: "deepseek-v4-flash",
    displayName: "HomeLab DeepSeek-V4-Flash",
    baseUrl: "https://api.homelabai.org/v1",
    apiKey: "sk-studio-key",
    contextWindow: 128000,
    maxTokens: 128000,
    reasoning: true,
    images: false,
    ...overrides,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf-8"));
const readYaml = (file: string) => JSON.parse(readFileSync(file, "utf-8")); // yaml output is still JSON-like

test("detect: home with all four agents present, and a home with none", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".pi"), { recursive: true });
  mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  mkdirSync(path.join(home, ".factory"), { recursive: true });
  mkdirSync(path.join(home, ".hermes"), { recursive: true });
  writeFileSync(path.join(home, ".factory", "settings.json"), '{"customModels": []}\n');
  writeFileSync(path.join(home, ".hermes", "config.yaml"), 'custom_models: []\n');

  const targets = await detectLocalAgents(home);
  assert.deepEqual(
    targets.map((t) => [t.agent, t.configPath, t.exists]),
    [
      ["pi", path.join(home, ".pi", "agent", "models.json"), false],
      ["opencode", path.join(home, ".config", "opencode", "opencode.json"), false],
      ["droid", path.join(home, ".factory", "settings.json"), true],
      ["hermes", path.join(home, ".hermes", "config.yaml"), true],
    ],
  );

  const emptyHome = makeHome();
  assert.deepEqual(await detectLocalAgents(emptyHome), []);
});

test("pi: upserts into an existing same-baseUrl provider without touching its apiKey", async () => {
  const home = makeHome();
  const agentDir = path.join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  const configPath = path.join(agentDir, "models.json");
  const fixture = {
    providers: {
      homelab: {
        // Trailing slash on purpose: matching must be trailing-slash-insensitive.
        baseUrl: "https://api.homelabai.org/v1/",
        apiKey: "sk-original-key",
        api: "openai-completions",
        models: [
          {
            id: "other-model",
            name: "Other Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 32000,
            maxTokens: 32000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: {},
          },
        ],
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(fixture, null, 2)}\n`);
  const originalRaw = readFileSync(configPath, "utf-8");

  const [result] = await attachModelToAgents({ home, targets: ["pi"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");
  assert.equal(result.configPath, configPath);
  assert.ok(result.backupPath, "modifying an existing file must create a backup");
  assert.equal(readFileSync(result.backupPath!, "utf-8"), originalRaw);

  const written = readJson(configPath);
  assert.deepEqual(Object.keys(written.providers), ["homelab"], "no new provider key");
  assert.equal(written.providers.homelab.apiKey, "sk-original-key");
  assert.equal(written.providers.homelab.models.length, 2);
  const entry = written.providers.homelab.models[1];
  assert.deepEqual(entry, {
    id: "deepseek-v4-flash",
    name: "HomeLab DeepSeek-V4-Flash",
    reasoning: true,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 128000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {},
  });
  // Untouched sibling model preserved exactly.
  assert.deepEqual(written.providers.homelab.models[0], fixture.providers.homelab.models[0]);

  // Idempotency: attaching again updates in place, no duplicates.
  const [second] = await attachModelToAgents({ home, targets: ["pi"], model: makeModel() });
  assert.equal(second.ok, true);
  assert.equal(second.action, "updated");
  assert.equal(readJson(configPath).providers.homelab.models.length, 2);
});

test("pi: creates models.json with a local-studio provider when only ~/.pi exists", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".pi"), { recursive: true });

  const [result] = await attachModelToAgents({ home, targets: ["pi"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "created-file");
  assert.equal(result.backupPath, undefined, "no backup for a freshly created file");

  const configPath = path.join(home, ".pi", "agent", "models.json");
  assert.equal(result.configPath, configPath);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);

  const written = readJson(configPath);
  const provider = written.providers["local-studio"];
  assert.equal(provider.api, "openai-completions");
  assert.equal(provider.baseUrl, "https://api.homelabai.org/v1");
  assert.equal(provider.apiKey, "sk-studio-key");
  assert.equal(provider.models.length, 1);
  assert.equal(provider.models[0].id, "deepseek-v4-flash");

  // Atomic write must not leave tmp files behind.
  assert.deepEqual(readdirSync(path.join(home, ".pi", "agent")), ["models.json"]);
});

test("pi: writes image input for image-capable models", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".pi"), { recursive: true });

  const [result] = await attachModelToAgents({
    home,
    targets: ["pi"],
    model: makeModel({
      modelId: "step-3.7-flash",
      displayName: "Step 3.7 Flash",
      contextWindow: 262144,
      maxTokens: 131072,
      images: true,
    }),
  });
  assert.equal(result.ok, true);

  const configPath = path.join(home, ".pi", "agent", "models.json");
  const model = readJson(configPath).providers["local-studio"].models[0];
  assert.equal(model.id, "step-3.7-flash");
  assert.deepEqual(model.input, ["text", "image"]);
});

test("opencode: adds a new provider and preserves every other key", async () => {
  const home = makeHome();
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "opencode.json");
  const fixture = {
    $schema: "https://opencode.ai/config.json",
    model: "anthropic/claude-sonnet-4-5",
    agent: { build: { model: "anthropic/claude-sonnet-4-5" } },
    permission: { edit: "ask", bash: { "git push": "ask" } },
    provider: {
      anthropic: {
        npm: "@ai-sdk/anthropic",
        name: "Anthropic",
        options: { apiKey: "sk-ant-key" },
        models: { "claude-sonnet-4-5": { name: "Claude Sonnet" } },
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(fixture, null, 2)}\n`);

  const [result] = await attachModelToAgents({ home, targets: ["opencode"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");
  assert.equal(result.configPath, configPath);
  assert.ok(result.backupPath);

  const written = readJson(configPath);
  // Untouched subtrees survive byte-for-byte semantically.
  assert.equal(written.$schema, fixture.$schema);
  assert.equal(written.model, fixture.model);
  assert.deepEqual(written.agent, fixture.agent);
  assert.deepEqual(written.permission, fixture.permission);
  assert.deepEqual(written.provider.anthropic, fixture.provider.anthropic);

  assert.deepEqual(written.provider["local-studio"], {
    npm: "@ai-sdk/openai-compatible",
    name: "Local Studio",
    options: { baseURL: "https://api.homelabai.org/v1", apiKey: "sk-studio-key" },
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "HomeLab DeepSeek-V4-Flash",
        limit: { context: 128000, output: 128000 },
      },
    },
  });
});

test("opencode: upserts into an existing matching-baseURL provider, leaving its options alone", async () => {
  const home = makeHome();
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "opencode.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        provider: {
          homelab: {
            npm: "@ai-sdk/openai-compatible",
            name: "HomeLab",
            options: { baseURL: "https://api.homelabai.org/v1/", apiKey: "sk-existing" },
            models: { "old-model": { name: "Old" } },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const [result] = await attachModelToAgents({ home, targets: ["opencode"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");

  const written = readJson(configPath);
  assert.deepEqual(Object.keys(written.provider), ["homelab"], "no new provider key");
  assert.deepEqual(written.provider.homelab.options, {
    baseURL: "https://api.homelabai.org/v1/",
    apiKey: "sk-existing",
  });
  assert.deepEqual(Object.keys(written.provider.homelab.models).sort(), [
    "deepseek-v4-flash",
    "old-model",
  ]);

  // Re-attach: updated, still no duplicates.
  const [second] = await attachModelToAgents({ home, targets: ["opencode"], model: makeModel() });
  assert.equal(second.action, "updated");
  assert.equal(Object.keys(readJson(configPath).provider.homelab.models).length, 2);
});

test("droid: appends with next index + slug id; re-attach updates in place", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".factory"), { recursive: true });
  const configPath = path.join(home, ".factory", "settings.json");
  const fixture = {
    hooks: { preToolUse: [{ command: "echo hi" }] },
    customModels: [
      {
        model: "old-model",
        id: "custom:Old-Model-3",
        index: 3,
        baseUrl: "https://other.example.com/v1",
        apiKey: "sk-other",
        displayName: "Old Model",
        maxContextLimit: 32000,
        noImageSupport: true,
        provider: "generic-chat-completion-api",
      },
    ],
  };
  writeFileSync(configPath, `${JSON.stringify(fixture, null, 2)}\n`);

  const [result] = await attachModelToAgents({ home, targets: ["droid"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");

  let written = readJson(configPath);
  assert.deepEqual(written.hooks, fixture.hooks, "other settings.json keys preserved");
  assert.equal(written.customModels.length, 2);
  assert.deepEqual(written.customModels[0], fixture.customModels[0]);
  assert.deepEqual(written.customModels[1], {
    model: "deepseek-v4-flash",
    id: "custom:HomeLab-DeepSeek-V4-Flash-4",
    index: 4,
    baseUrl: "https://api.homelabai.org/v1",
    apiKey: "sk-studio-key",
    displayName: "HomeLab DeepSeek-V4-Flash",
    maxContextLimit: 128000,
    noImageSupport: true,
    provider: "generic-chat-completion-api",
  });

  // Re-attach the same model (new key, larger context): updated in place.
  const [second] = await attachModelToAgents({
    home,
    targets: ["droid"],
    model: makeModel({ apiKey: "sk-rotated", contextWindow: 200000 }),
  });
  assert.equal(second.ok, true);
  assert.equal(second.action, "updated");

  written = readJson(configPath);
  assert.equal(written.customModels.length, 2, "no duplicate entry");
  const updated = written.customModels[1];
  assert.equal(updated.id, "custom:HomeLab-DeepSeek-V4-Flash-4", "id kept");
  assert.equal(updated.index, 4, "index kept");
  assert.equal(updated.apiKey, "sk-rotated");
  assert.equal(updated.maxContextLimit, 200000);
});

test("hermes: appends to custom_models and updates existing entry by model+base_url", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".hermes"), { recursive: true });
  const configPath = path.join(home, ".hermes", "config.yaml");
  const fixture = `model:\n  default: old-model\n  provider: custom\n  base_url: https://other.example.com/v1\n  api_key: sk-other\n  api_mode: anthropic_messages\n  extra_headers: null\ncustom_models:\n  - name: Old Model\n    model: old-model\n    base_url: https://other.example.com/v1\n    api_key: sk-other\n    provider: openai\n    reasoning_effort: medium\n    index: 0\n`;
  writeFileSync(configPath, fixture);

  const [result] = await attachModelToAgents({ home, targets: ["hermes"], model: makeModel() });
  assert.equal(result.ok, true);
  assert.equal(result.action, "added");

  const written = readFileSync(configPath, "utf-8");
  assert.ok(written.includes("name: HomeLab DeepSeek-V4-Flash"));
  assert.ok(written.includes("model: deepseek-v4-flash"));
  assert.ok(written.includes("base_url: https://api.homelabai.org/v1"));
  assert.ok(written.includes("api_key: sk-studio-key"));
  assert.ok(written.includes("provider: custom"));
  assert.ok(written.includes("reasoning_effort: high"));
  assert.ok(written.includes("index: 1"));
  assert.ok(written.includes("index: 0"), "old entry preserved");

  // Re-attach same model: updated in place, no duplicate.
  const [second] = await attachModelToAgents({ home, targets: ["hermes"], model: makeModel() });
  assert.equal(second.ok, true);
  assert.equal(second.action, "updated");

  const updated = readFileSync(configPath, "utf-8");
  const match = updated.match(/name: HomeLab DeepSeek-V4-Flash[\s\S]*?index: (\d+)/);
  assert.ok(match);
  assert.equal(updated.match(/name: HomeLab DeepSeek-V4-Flash/g)?.length, 1, "no duplicate entry");
});

test("invalid JSON: that target fails, others succeed, broken file is untouched", async () => {
  const home = makeHome();
  const agentDir = path.join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(path.join(home, ".factory"), { recursive: true });
  const brokenPath = path.join(agentDir, "models.json");
  writeFileSync(brokenPath, '{ "providers": { broken\n');
  const brokenRaw = readFileSync(brokenPath, "utf-8");

  const results = await attachModelToAgents({
    home,
    targets: ["pi", "droid"],
    model: makeModel(),
  });
  const pi = results.find((r) => r.agent === "pi")!;
  const droid = results.find((r) => r.agent === "droid")!;

  assert.equal(pi.ok, false);
  assert.match(pi.error ?? "", /not valid JSON/);
  assert.equal(readFileSync(brokenPath, "utf-8"), brokenRaw, "broken file not modified");
  assert.deepEqual(readdirSync(agentDir), ["models.json"], "no backup/tmp for the failed target");

  assert.equal(droid.ok, true);
  assert.equal(droid.action, "created-file");
  assert.deepEqual(readJson(path.join(home, ".factory", "settings.json")).customModels.length, 1);
});

test("targets that are not detected fail cleanly without touching the filesystem", async () => {
  const home = makeHome();
  mkdirSync(path.join(home, ".factory"), { recursive: true });

  const results = await attachModelToAgents({
    home,
    targets: ["pi", "opencode", "droid", "hermes"],
    model: makeModel(),
  });
  assert.deepEqual(
    results.map((r) => [r.agent, r.ok]),
    [
      ["pi", false],
      ["opencode", false],
      ["droid", true],
      ["hermes", false],
    ],
  );
  assert.match(results[0].error ?? "", /not installed/);
  assert.deepEqual(readdirSync(home).sort(), [".factory"]);
});
