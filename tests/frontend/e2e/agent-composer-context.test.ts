import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentDedupKey,
  attachmentPrompt,
  createProjectFileAttachment,
} from "@/app/agent/_components/chat-attachments";
import {
  byQuery,
  consumeComposerMention,
  detectComposerMention,
  sanitizeComposerExtensionOverrides,
  type ComposerExtensionRef,
} from "@/lib/agent/composer-context";
import {
  selectionFromPersistedTab,
  sessionMetaForPersistence,
} from "@/lib/agent/workspace/store";
import type { Session } from "@/lib/agent/sessions/types";

test("file tagging turns an @ mention into one durable project-file attachment", () => {
  const input = "please inspect @src/app.ts";
  const mention = detectComposerMention(input, input.length);

  assert.deepEqual(mention, {
    kind: "plugin",
    query: "src/app.ts",
    start: 15,
    end: input.length,
  });
  assert.equal(consumeComposerMention(input, mention), "please inspect");

  const attachment = createProjectFileAttachment({
    id: "file:src/app.ts",
    name: "app.ts",
    path: "/workspace/project/src/app.ts",
    content: "export const ok = true;",
    truncated: false,
    size: 23,
  });
  const duplicate = createProjectFileAttachment({
    id: "file:src/app.ts:again",
    name: "renamed.ts",
    path: "/workspace/project/src/app.ts",
    content: "different render payload",
    truncated: false,
    size: 999,
  });

  assert.equal(attachment.mode, "text");
  assert.equal(attachmentDedupKey(attachment), attachmentDedupKey(duplicate));
  assert.match(attachmentPrompt([attachment]), /Attachment 1: app\.ts/);
  assert.match(
    attachmentPrompt([attachment]),
    /Local path: \/workspace\/project\/src\/app\.ts/,
  );
  assert.match(attachmentPrompt([attachment]), /export const ok = true;/);
});

test("truncated tagged files stay metadata-only while preserving the local path", () => {
  const attachment = createProjectFileAttachment({
    id: "file:large.bin",
    name: "large.bin",
    path: "/workspace/project/large.bin",
    content: "binary payload should not be inlined",
    truncated: true,
    size: 4_000_000,
  });
  const prompt = attachmentPrompt([attachment]);

  assert.equal(attachment.mode, "metadata");
  assert.match(
    attachment.content,
    /available on disk at \/workspace\/project\/large\.bin/,
  );
  assert.match(prompt, /Attachment 1: large\.bin/);
  assert.match(prompt, /Local path: \/workspace\/project\/large\.bin/);
  assert.doesNotMatch(prompt, /binary payload should not be inlined/);
});

test("Pi extension slash selection is searchable and persists per-turn overrides", () => {
  const mention = detectComposerMention(
    "/plugins browser",
    "/plugins browser".length,
  );
  const extensions: ComposerExtensionRef[] = [
    {
      id: "npm:@openai/browser",
      name: "browser",
      source: "npm:@openai/browser",
      path: "/Users/sero/.pi/extensions/browser",
      scope: "user",
      origin: "package",
      enabled: true,
    },
    {
      id: "auto:/Users/sero/.pi/extensions/unused",
      name: "unused",
      source: "auto",
      path: "/Users/sero/.pi/extensions/unused",
      scope: "user",
      origin: "top-level",
      enabled: false,
    },
  ];
  const overrides = sanitizeComposerExtensionOverrides([
    { key: "npm:@openai/browser", enabled: false },
    { key: "npm:@openai/browser", enabled: true },
    { key: "", enabled: true },
    { key: "/tmp/not-valid", enabled: "yes" },
  ]);
  const session = {
    id: "s-ext",
    runtimeSessionId: "rt-ext",
    piSessionId: null,
    title: "Extension run",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  } satisfies Session;

  assert.deepEqual(mention, {
    kind: "extension",
    query: "browser",
    start: 0,
    end: "/plugins browser".length,
  });
  assert.deepEqual(
    byQuery(extensions, "browser").map((extension) => extension.id),
    ["npm:@openai/browser"],
  );
  assert.deepEqual(overrides, [{ key: "npm:@openai/browser", enabled: false }]);

  const persisted = sessionMetaForPersistence(session, {
    plugins: [],
    skills: [],
    promptTemplates: [],
    extensionOverrides: overrides,
  });
  assert.deepEqual(persisted.extensionOverrides, overrides);
  assert.deepEqual(
    selectionFromPersistedTab(persisted)?.extensionOverrides,
    overrides,
  );
});
