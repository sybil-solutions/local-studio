import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "../../../shared/agent/models";
import {
  persistLitterPromptBoundary,
  resolvePiRuntimeStartOptions,
  selectPiRuntimeModel,
} from "../src/pi-runtime";

test("Pi persists a hidden Litter marker after an exact user transcript entry", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "local-studio-pi-litter-"));
  const cwd = path.join(directory, "project");
  const sessionId = "session-litter-1";
  const filepath = path.join(directory, `${sessionId}.jsonl`);
  writeFileSync(
    filepath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-20T18:29:00.000Z",
      cwd,
    })}\n${JSON.stringify({
      type: "message",
      id: "assistant-existing",
      parentId: null,
      timestamp: "2026-07-20T18:29:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Ready" }],
        provider: "provider-a",
        model: "model-a",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 1,
      },
    })}\n`,
  );
  const manager = SessionManager.open(filepath, directory, cwd);
  const startEntryCount = manager.getEntries().length;
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Continue from mobile" }],
    timestamp: Date.now(),
  });
  const boundary = persistLitterPromptBoundary({
    sessionManager: manager,
    startEntryCount,
    message: "Continue from mobile",
    marker: {
      dispatchId: "dispatch-1",
      messageId: "message-1",
      contentHash: "a".repeat(64),
    },
    modelId: "provider-a/model-a",
  });
  assert.equal(boundary.piSessionId, sessionId);
  assert.equal(boundary.sessionFile, filepath);
  const persisted = readFileSync(filepath, "utf8");
  assert.match(persisted, /local_studio_litter_turn_v1/);
  const hydrated = SessionManager.open(filepath, directory, cwd).buildSessionContext();
  assert.equal(JSON.stringify(hydrated.messages).includes("local_studio_litter_turn_v1"), false);
  assert.equal(JSON.stringify(hydrated.messages).includes("Continue from mobile"), true);
});

test("Pi model resolution requires provider qualification when raw IDs collide", () => {
  const model = (id: string, rawId: string, providerId: string): AgentModel => ({
    id,
    rawId,
    providerId,
    name: id,
    provider: "local-studio",
    contextWindow: 128_000,
    maxTokens: 16_000,
    reasoning: true,
    vision: false,
    active: false,
  });
  const models = [
    model("local-studio-a/shared", "shared", "local-studio-a"),
    model("local-studio-b/shared", "shared", "local-studio-b"),
  ];
  assert.equal(selectPiRuntimeModel(models, "local-studio-b/shared")?.providerId, "local-studio-b");
  assert.throws(() => selectPiRuntimeModel(models, "shared"), /ambiguous/i);
});

test("Pi preserves reasoning, skills, templates, and tools when restart options are omitted", () => {
  const current = {
    thinkingLevel: "xhigh" as const,
    browserToolEnabled: true,
    canvasEnabled: true,
    skills: [{ id: "skill-1", path: "/tmp/skill-1" }],
    promptTemplates: [{ id: "template-1", path: "/tmp/template-1" }],
  };
  const preserved = resolvePiRuntimeStartOptions(current, true);
  assert.deepEqual(preserved, current);
  assert.notEqual(preserved, current);
  assert.deepEqual(resolvePiRuntimeStartOptions(current, true, { thinkingLevel: "low" }), {
    thinkingLevel: "low",
  });
  assert.deepEqual(resolvePiRuntimeStartOptions(current, false), {});
});
