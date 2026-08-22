import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

const dataDir = mkdtempSync(path.join(tmpdir(), "google-account-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;

import type { GoogleOAuthDependencies } from "../src/google-account";

const {
  beginGoogleAuthorization,
  clearGoogleAuthorizationCache,
  completeGoogleAuthorizationWithActivation,
  createGoogleAuthorizationFlow,
  disconnectGoogleAccount,
  getGoogleAccount,
  googleAccountKey,
  googleAuthorizationHeaders,
  resolveGoogleAccountFilePath,
  saveGoogleClient,
} = await import("../src/google-account");
const { GOOGLE_WORKSPACE_BINDINGS } = await import("../src/google-workspace-binding");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

type VaultRecord = Map<string, string>;

function fakeVault(store: VaultRecord) {
  return {
    read: (key: string) => Effect.succeed(store.get(key)),
    write: (key: string, value: string) => Effect.sync(() => void store.set(key, value)),
    remove: (key: string) => Effect.sync(() => void store.delete(key)),
  };
}

type Recorded = { revoked: string[] };

function fakeDependencies(emails: string[], recorded: Recorded): GoogleOAuthDependencies {
  let issued = 0;
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return {
    now: () => 1_700_000_000_000,
    random: (size: number) => Buffer.alloc(size, issued + 1),
    verifyAccess: () => Promise.resolve(),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/revoke")) {
        recorded.revoked.push(String(init?.body).replace("token=", ""));
        return respond({});
      }
      if (url.endsWith("/token")) {
        issued += 1;
        return respond({
          access_token: `access-${issued}`,
          refresh_token: `refresh-${issued}`,
          expires_in: 3600,
          scope: ["openid", "email", ...GOOGLE_WORKSPACE_BINDINGS.gmail.scopes].join(" "),
        });
      }
      if (url.includes("userinfo")) {
        return respond({ email: emails[Math.min(issued, emails.length) - 1] });
      }
      throw new Error(`unexpected request ${url}`);
    }) as typeof fetch,
  };
}

async function connect(
  service: "gmail" | "google-calendar",
  store: VaultRecord,
  dependencies: GoogleOAuthDependencies,
) {
  const vault = fakeVault(store);
  const flowId = createGoogleAuthorizationFlow(service);
  await Effect.runPromise(
    beginGoogleAuthorization(
      service,
      "http://127.0.0.1:41234/callback",
      dependencies,
      vault,
      flowId,
    ),
  );
  const pending = JSON.parse(store.get(`google-workspace-pending:${service}`) ?? "{}");
  return Effect.runPromise(
    completeGoogleAuthorizationWithActivation(
      service,
      { state: pending.state, code: "auth-code" },
      flowId,
      () => Effect.succeed(true),
      () => Effect.succeed(true),
      dependencies,
      vault,
    ),
  );
}

describe("google accounts are keyed by mailbox", () => {
  let store: VaultRecord;
  let recorded: Recorded;

  beforeEach(async () => {
    store = new Map();
    recorded = { revoked: [] };
    rmSync(resolveGoogleAccountFilePath(), { force: true });
    clearGoogleAuthorizationCache();
    await Effect.runPromise(
      saveGoogleClient({ clientId: "client-1" }, fakeVault(store), fakeDependencies([], recorded)),
    );
  });

  test("two mailboxes become two accounts with distinct keys", async () => {
    const dependencies = fakeDependencies(["one@example.com", "two@example.com"], recorded);
    const first = await connect("gmail", store, dependencies);
    const second = await connect("gmail", store, dependencies);
    expect(first.identity.accountKey).toBe(googleAccountKey("one@example.com"));
    expect(second.identity.accountKey).toBe(googleAccountKey("two@example.com"));
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.accounts.map((entry) => entry.email)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
  });

  test("re-authorizing a mailbox rotates it instead of adding a duplicate", async () => {
    const dependencies = fakeDependencies(["one@example.com", "one@example.com"], recorded);
    await connect("gmail", store, dependencies);
    await connect("gmail", store, dependencies);
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.accounts).toHaveLength(1);
  });

  test("disconnecting one mailbox leaves the other's grant alone", async () => {
    const dependencies = fakeDependencies(["one@example.com", "two@example.com"], recorded);
    const first = await connect("gmail", store, dependencies);
    await connect("gmail", store, dependencies);
    await Effect.runPromise(
      disconnectGoogleAccount(first.identity, fakeVault(store), dependencies),
    );
    // Exactly the disconnected mailbox's grant is handed back.
    expect(recorded.revoked).toEqual(["refresh-1"]);
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.accounts.map((entry) => entry.email)).toEqual(["two@example.com"]);
    const headers = await Effect.runPromise(
      googleAuthorizationHeaders(
        { service: "gmail", accountKey: googleAccountKey("two@example.com") },
        true,
        dependencies,
        fakeVault(store),
      ),
    );
    expect(headers.Authorization).toContain("Bearer ");
  });

  test("changing the client revokes every account, not just the first", async () => {
    const dependencies = fakeDependencies(["one@example.com", "two@example.com"], recorded);
    await connect("gmail", store, dependencies);
    await connect("gmail", store, dependencies);
    await Effect.runPromise(
      saveGoogleClient({ clientId: "client-2" }, fakeVault(store), dependencies),
    );
    expect(recorded.revoked.sort()).toEqual(["refresh-1", "refresh-2"]);
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.accounts).toHaveLength(0);
  });

  test("the single-account layout on disk is read as one keyed account", async () => {
    writeFileSync(
      resolveGoogleAccountFilePath(),
      JSON.stringify({
        clientId: "client-legacy",
        hasClientSecret: false,
        connections: {
          gmail: {
            email: "Legacy@Example.com",
            scopes: [...GOOGLE_WORKSPACE_BINDINGS.gmail.scopes],
            resource: "https://gmailmcp.googleapis.com/mcp",
            connectedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]?.key).toBe(googleAccountKey("legacy@example.com"));
    expect(view.accounts[0]?.connections.gmail.connected).toBe(true);
  });
});
