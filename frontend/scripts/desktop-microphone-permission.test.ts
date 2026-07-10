import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allowsMicrophonePermission,
  type MicrophonePermissionInput,
} from "../desktop/logic/security";

const appOrigin = "http://127.0.0.1:61449";
const mainWebContents = {};

const handlerInputs = {
  check: {
    appOrigin,
    isMainFrame: true,
    mainWebContents,
    mediaTypes: ["audio"],
    permission: "media",
    requestingOrigin: appOrigin,
    requestingUrl: `${appOrigin}/agent`,
    requestingWebContents: mainWebContents,
  },
  request: {
    appOrigin,
    isMainFrame: true,
    mainWebContents,
    mediaTypes: ["audio"],
    permission: "media",
    requestingOrigin: `${appOrigin}/`,
    requestingUrl: `${appOrigin}/agent`,
    requestingWebContents: mainWebContents,
  },
} satisfies Record<string, MicrophonePermissionInput>;

const denials: ReadonlyArray<{
  expected: Partial<MicrophonePermissionInput>;
  name: string;
}> = [
  { name: "video", expected: { mediaTypes: ["video"] } },
  { name: "mixed audio and video", expected: { mediaTypes: ["audio", "video"] } },
  { name: "missing media type", expected: { mediaTypes: undefined } },
  { name: "display capture", expected: { permission: "display-capture" } },
  { name: "speaker selection", expected: { permission: "speaker-selection" } },
  { name: "external origin", expected: { requestingOrigin: "https://example.com" } },
  { name: "external frame URL", expected: { requestingUrl: "https://example.com/agent" } },
  { name: "opaque origin", expected: { requestingOrigin: "null" } },
  { name: "subframe", expected: { isMainFrame: false } },
  { name: "webview", expected: { requestingWebContents: {} } },
  { name: "null contents", expected: { requestingWebContents: null } },
];

for (const [handler, input] of Object.entries(handlerInputs)) {
  test(`${handler} permits audio from the main Local Studio frame`, () => {
    assert.equal(allowsMicrophonePermission(input), true);
  });

  for (const denial of denials) {
    test(`${handler} denies ${denial.name}`, () => {
      assert.equal(allowsMicrophonePermission({ ...input, ...denial.expected }), false);
    });
  }
}

test("mac package requests private local own-voice microphone access", async () => {
  const desktop = new URL("../desktop/", import.meta.url);
  const [builder, entitlements] = await Promise.all([
    readFile(new URL("electron-builder.yml", desktop), "utf8"),
    readFile(new URL("resources/entitlements.mac.plist", desktop), "utf8"),
  ]);

  assert.match(
    builder,
    /NSMicrophoneUsageDescription: Record your own voice to create a private, local voice profile\./,
  );
  assert.match(entitlements, /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
  assert.match(entitlements, /<key>com\.apple\.security\.app-sandbox<\/key>\s*<false\/>/);
});
