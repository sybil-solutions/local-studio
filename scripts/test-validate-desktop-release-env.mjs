import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  missingDesktopReleaseSecrets,
  reportDesktopReleaseEnvironment,
} from "./validate-desktop-release-env.mjs";

test("reports every missing desktop release secret", () => {
  assert.deepEqual(missingDesktopReleaseSecrets({}), [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ]);
});

test("treats blank desktop release secrets as missing", () => {
  assert.deepEqual(
    missingDesktopReleaseSecrets({
      CSC_LINK: " ",
      CSC_KEY_PASSWORD: "password",
      APPLE_ID: "",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "TEAMID",
    }),
    ["CSC_LINK", "APPLE_ID"],
  );
});

test("reports a configured environment to the workflow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-studio-release-env-"));
  const outputPath = path.join(root, "github-output");
  const env = {
    CSC_LINK: "base64-p12",
    CSC_KEY_PASSWORD: "password",
    APPLE_ID: "release@example.com",
    APPLE_APP_SPECIFIC_PASSWORD: "app-password",
    APPLE_TEAM_ID: "TEAMID",
  };

  assert.deepEqual(missingDesktopReleaseSecrets(env), []);
  assert.deepEqual(await reportDesktopReleaseEnvironment({ env, outputPath }), []);
  assert.equal(await readFile(outputPath, "utf8"), "configured=true\n");
});

test("reports an unconfigured environment without failing the release", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-studio-release-env-"));
  const outputPath = path.join(root, "github-output");

  assert.deepEqual(await reportDesktopReleaseEnvironment({ env: {}, outputPath }), [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ]);
  assert.equal(await readFile(outputPath, "utf8"), "configured=false\n");
});
