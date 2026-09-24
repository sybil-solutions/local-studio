import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

const dataDir = mkdtempSync(path.join(tmpdir(), "google-remote-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;

import type { GoogleOAuthDependencies } from "../src/google-account";

const {
  beginGoogleAuthorization,
  clearGoogleAuthorizationCache,
  completeGoogleAuthorizationWithActivation,
  createGoogleAuthorizationFlow,
  resolveGoogleAccountFilePath,
  saveGoogleClient,
} = await import("../src/google-account");
const { completeGoogleAuthorizationFromRedirect } = await import("../src/google-oauth-loopback");
const { fileOAuthVault, resolveFileOAuthVaultPath } = await import("../src/oauth-vault");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function fakeVault(store: Map<string, string>) {
  return {
    read: (key: string) => Effect.succeed(store.get(key)),
    write: (key: string, value: string) => Effect.sync(() => void store.set(key, value)),
    remove: (key: string) => Effect.sync(() => void store.delete(key)),
  };
}

function rejectingDependencies(): GoogleOAuthDependencies {
  return {
    now: () => 1_700_000_000_000,
    random: (size: number) => Buffer.alloc(size, 7),
    verifyAccess: () => Promise.resolve(),
    fetch: (async () =>
      new Response(
        JSON.stringify({ error: "invalid_request", error_description: "client_secret is missing." }),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch,
  };
}

describe("google workspace sign-in outside the desktop app", () => {
  beforeEach(() => {
    rmSync(resolveGoogleAccountFilePath(), { force: true });
    rmSync(resolveFileOAuthVaultPath(), { force: true });
    clearGoogleAuthorizationCache();
  });

  test("a client saved without its secret is refused", async () => {
    const saved = Effect.runPromise(
      saveGoogleClient({ clientId: "client-1" }, fakeVault(new Map()), rejectingDependencies()),
    );
    await expect(saved).rejects.toThrow("Client secret is required");
  });

  test("the stored secret carries over when the same client is saved again", async () => {
    const store = new Map<string, string>();
    const dependencies = rejectingDependencies();
    await Effect.runPromise(
      saveGoogleClient({ clientId: "client-1", clientSecret: "secret" }, fakeVault(store), dependencies),
    );
    const view = await Effect.runPromise(
      saveGoogleClient({ clientId: "client-1" }, fakeVault(store), dependencies),
    );
    expect(view.hasClientSecret).toBe(true);
  });

  test("google's own rejection reason reaches the caller", async () => {
    const store = new Map<string, string>();
    const vault = fakeVault(store);
    const dependencies = rejectingDependencies();
    await Effect.runPromise(
      saveGoogleClient({ clientId: "client-1", clientSecret: "secret" }, vault, dependencies),
    );
    const flowId = createGoogleAuthorizationFlow("gmail");
    await Effect.runPromise(
      beginGoogleAuthorization("gmail", "http://127.0.0.1:41234/callback", dependencies, vault, flowId),
    );
    const pending = JSON.parse(store.get("google-workspace-pending:gmail") ?? "{}");
    const completed = Effect.runPromise(
      completeGoogleAuthorizationWithActivation(
        "gmail",
        { state: pending.state, code: "code" },
        flowId,
        () => Effect.succeed(true),
        () => Effect.succeed(true),
        dependencies,
        vault,
      ),
    );
    await expect(completed).rejects.toThrow("client_secret is missing.");
  });

  test("the file vault round-trips secrets in an owner-only file", async () => {
    await Effect.runPromise(fileOAuthVault.write("google-workspace", '{"version":2}'));
    expect(await Effect.runPromise(fileOAuthVault.read("google-workspace"))).toBe('{"version":2}');
    expect(statSync(resolveFileOAuthVaultPath()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(resolveFileOAuthVaultPath(), "utf8"))).toHaveProperty(
      "google-workspace",
    );
    await Effect.runPromise(fileOAuthVault.remove("google-workspace"));
    expect(await Effect.runPromise(fileOAuthVault.read("google-workspace"))).toBeUndefined();
  });

  test("a pasted redirect without a sign-in in progress is refused", async () => {
    await expect(
      completeGoogleAuthorizationFromRedirect(
        "gmail",
        "http://127.0.0.1:5555/callback?state=s&code=c",
      ),
    ).rejects.toThrow("No Google sign-in is in progress");
  });
});
