import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { GITHUB_CONNECTOR_TOKEN_KEY } from "@local-studio/agent-runtime/connector-contract";
import { githubCredentialUpdate, hasStoredGitHubCredential } from "./github-connector-credentials";

const drawerSource = readFileSync(new URL("./connectors-section.tsx", import.meta.url), "utf8");

describe("GitHub connector credential recovery", () => {
  test("builds a replacement-only payload without retaining a displayed secret", () => {
    assert.deepEqual(githubCredentialUpdate("  fixture-token  "), {
      id: "github",
      catalogId: "github",
      env: { [GITHUB_CONNECTOR_TOKEN_KEY]: "fixture-token" },
      enabled: true,
    });
    assert.throws(() => githubCredentialUpdate(""), /Enter a new personal access token/);
  });

  test("recognizes stored credentials by secret metadata instead of secret values", () => {
    assert.equal(hasStoredGitHubCredential({ secret_keys: [GITHUB_CONNECTOR_TOKEN_KEY] }), true);
    assert.equal(hasStoredGitHubCredential({ secret_keys: [] }), false);
    assert.equal(hasStoredGitHubCredential(null), false);
  });

  test("keeps the repair field blank and offers explicit update and removal actions", () => {
    assert.match(drawerSource, /const \[githubToken, setGitHubToken\] = useState\(""\)/);
    assert.match(drawerSource, /type="password"[\s\S]*value=\{githubToken\}/);
    assert.match(drawerSource, /Update credential and enable/);
    assert.match(drawerSource, /Remove connector/);
    assert.doesNotMatch(drawerSource, /setGitHubToken\([^)]*connector\.env/);
  });
});
