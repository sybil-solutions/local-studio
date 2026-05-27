import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = mkdtempSync(path.join(tmpdir(), "vllm-studio-settings-api-"));
process.env.VLLM_STUDIO_DATA_DIR = dataDir;
writeFileSync(path.join(dataDir, "api-settings.json"), "{}", "utf-8");

async function loadApiSettings() {
  return import("@/lib/api-settings");
}

async function loadVoiceTarget() {
  return import("@/app/api/voice/voice-target");
}

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("settings persistence saves controller, voice, and API key settings securely", async () => {
  const { getApiSettings, maskApiKey, saveApiSettings } = await loadApiSettings();
  const apiKey = "sk-test-1234567890";

  await saveApiSettings({
    backendUrl: "https://controller.local:8080",
    apiKey,
    voiceUrl: "https://voice.local:9000",
    voiceModel: "whisper-large-v3",
  });

  const savedPath = path.join(dataDir, "api-settings.json");
  const saved = JSON.parse(readFileSync(savedPath, "utf-8"));
  assert.deepEqual(saved, {
    backendUrl: "https://controller.local:8080",
    apiKey,
    voiceUrl: "https://voice.local:9000",
    voiceModel: "whisper-large-v3",
  });
  assert.equal(statSync(savedPath).mode & 0o777, 0o600);

  assert.deepEqual(await getApiSettings(), {
    backendUrl: "https://controller.local:8080",
    apiKey,
    voiceUrl: "https://voice.local:9000",
    voiceModel: "whisper-large-v3",
  });
  assert.equal(maskApiKey(apiKey).startsWith("sk-t"), true);
  assert.equal(maskApiKey(apiKey).endsWith("7890"), true);
  assert.equal(maskApiKey(apiKey).includes("123456"), false);
  assert.equal(maskApiKey("short").length, 8);
  assert.equal(maskApiKey(""), "");
});

test("voice settings resolve controller-local and external targets", async () => {
  const { resolveVoiceTarget } = await loadVoiceTarget();
  assert.deepEqual(
    resolveVoiceTarget({
      backendUrl: "https://controller.local:8080/",
      apiKey: "",
      voiceUrl: "",
      voiceModel: "whisper",
    }),
    { baseUrl: "https://controller.local:8080", kind: "controller-local" },
  );

  assert.deepEqual(
    resolveVoiceTarget({
      backendUrl: "https://controller.local:8080",
      apiKey: "",
      voiceUrl: "https://voice.local:9000/",
      voiceModel: "whisper",
    }),
    { baseUrl: "https://voice.local:9000", kind: "external-voice" },
  );

  assert.equal(
    resolveVoiceTarget({
      backendUrl: "notaurl",
      apiKey: "",
      voiceUrl: "",
      voiceModel: "whisper",
    }),
    null,
  );
});
