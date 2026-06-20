import assert from "node:assert/strict";
import test from "node:test";
import { missingDesktopReleaseSecrets } from "./validate-desktop-release-env.mjs";

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

test("passes when all desktop release secrets are present", () => {
  assert.deepEqual(
    missingDesktopReleaseSecrets({
      CSC_LINK: "base64-p12",
      CSC_KEY_PASSWORD: "password",
      APPLE_ID: "release@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "TEAMID",
    }),
    [],
  );
});
