import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  createProjectFileAttachment,
} from "@/features/agent/ui/chat-attachments";
import {
  byQuery,
  consumeComposerMention,
  detectComposerMention,
} from "@/features/agent/composer-context";
import {
  selectionFromPersistedTab,
  sessionMetaForPersistence,
} from "@/features/agent/workspace/store";
import type { Session } from "@/features/agent/runtime/types";

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

test("image attachments are described as metadata for non-vision models", () => {
  const prompt = attachmentPrompt(
    [
      {
        id: "img:screenshot",
        name: "screenshot.png",
        type: "image/png",
        size: 1200,
        mode: "data-url",
        content: "data:image/png;base64,iVBORw0KGgo=",
        previewKind: "image",
        previewUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ],
    { modelSupportsVision: false },
  );

  assert.match(prompt, /selected model does not accept image input/);
  assert.match(prompt, /only attached as metadata/);
  assert.match(prompt, /cannot see it because only metadata was attached/);
  assert.doesNotMatch(prompt, /attached as multimodal input/);
  assert.doesNotMatch(prompt, /iVBORw0KGgo=/);
});

test("oversized image attachments explain the inline image limit", async () => {
  const file = new File([new Uint8Array(6_000_001)], "large-screenshot.png", {
    type: "image/png",
  });
  const attachment = await createAttachment(file);

  assert.equal(attachment.mode, "metadata");
  assert.match(attachment.content, /above the 5\.7 MB inline image limit/);
  assert.match(attachment.content, /only metadata is attached to the model/);
});

test("media attachments classify audio, video, and PDF previews", async () => {
  const [audio, video, pdf] = await Promise.all([
    createAttachment(
      new File([new Uint8Array([1, 2, 3])], "tone.wav", { type: "audio/wav" }),
    ),
    createAttachment(
      new File([new Uint8Array([4, 5, 6])], "clip.mp4", { type: "video/mp4" }),
    ),
    createAttachment(
      new File([new Uint8Array([7, 8, 9])], "brief.pdf", {
        type: "application/pdf",
      }),
    ),
  ]);

  assert.equal(audio.previewKind, "audio");
  assert.equal(video.previewKind, "video");
  assert.equal(pdf.previewKind, "pdf");
  assert.match(audio.content, /Media preview is visible/);
  assert.match(video.content, /Media preview is visible/);
  assert.match(pdf.content, /PDF preview is visible/);
});

test("MCP plugin slash and at-mention context persist selected plugin state", () => {
  const slashMention = detectComposerMention(
    "/plugins browser",
    "/plugins browser".length,
  );
  const pluginMention = detectComposerMention(
    "use @filesystem",
    "use @filesystem".length,
  );
  const plugins = [
    {
      id: "mcp-filesystem",
      name: "filesystem",
      path: "/Users/sero/.codex/mcp/filesystem",
      mcpConfigPath: "/Users/sero/.codex/mcp/filesystem/.mcp.json",
      source: "manual",
    },
    {
      id: "mcp-git",
      name: "git",
      path: "/Users/sero/.codex/mcp/git",
      mcpConfigPath: "/Users/sero/.codex/mcp/git/.mcp.json",
      source: "manual",
    },
  ];
  const session = {
    id: "s-plugin",
    runtimeSessionId: "rt-plugin",
    piSessionId: null,
    title: "Plugin run",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  } satisfies Session;

  assert.deepEqual(slashMention, {
    kind: "promptTemplate",
    query: "plugins browser",
    start: 0,
    end: "/plugins browser".length,
  });
  assert.deepEqual(pluginMention, {
    kind: "plugin",
    query: "filesystem",
    start: 4,
    end: "use @filesystem".length,
  });
  assert.deepEqual(
    byQuery(plugins, "filesystem").map((plugin) => plugin.id),
    ["mcp-filesystem"],
  );

  const persisted = sessionMetaForPersistence(session, {
    plugins: [plugins[0]],
    skills: [],
    promptTemplates: [],
  });
  assert.deepEqual(persisted.plugins, [plugins[0]]);
  assert.deepEqual(selectionFromPersistedTab(persisted)?.plugins, [plugins[0]]);
});
