import { afterAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "oauth-connectors-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;

import type { OAuthConnectorDependencies } from "../src/oauth-connectors";
import type { OAuthConnectorAuthDefinition } from "../src/oauth-connector-contract";
import type { ConnectorConfig } from "../src/connectors-service";

const {
  beginOAuthConnectorAuthorization,
  disconnectOAuthConnector,
  freshOAuthConnectorAccessToken,
  getOAuthConnectorStatus,
  oauthConnectorFlowSettled,
  oauthConnectorSpawnEnv,
  resolveOAuthTokensFilePath,
  saveOAuthConnectorClient,
} = await import("../src/oauth-connectors");
const { resolveConnectorTarget } = await import("../src/connector-pool");
const { listConnectors } = await import("../src/connectors-service");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

//
// A fake GitHub. Every endpoint the engine can touch lives on this loopback
// server; the real provider definitions are overridden through the dependency
// seam, so nothing in these tests reaches github.com.
//
type MockState = {
  devicePolls: number;
  allowDeviceGrant: boolean;
  denyDeviceGrant: boolean;
  refreshCalls: Array<Record<string, string>>;
  pkceChallenge: string | null;
  issuedTokens: string[];
};

const state: MockState = {
  devicePolls: 0,
  allowDeviceGrant: false,
  denyDeviceGrant: false,
  refreshCalls: [],
  pkceChallenge: null,
  issuedTokens: [],
};

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const mock = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/login/device/code") {
      return json({
        device_code: "device-code-1",
        user_code: "ABCD-1234",
        verification_uri: `http://127.0.0.1:${mock.port}/activate`,
        expires_in: 900,
        interval: 0.02,
      });
    }
    if (url.pathname === "/login/oauth/access_token") {
      const body = new URLSearchParams(await request.text());
      const grant = body.get("grant_type") ?? "";
      if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
        state.devicePolls += 1;
        if (state.denyDeviceGrant) return json({ error: "access_denied" });
        if (!state.allowDeviceGrant || state.devicePolls < 3) {
          return json({ error: "authorization_pending" });
        }
        state.issuedTokens.push("gho_device_access_1");
        return json({
          access_token: "gho_device_access_1",
          token_type: "bearer",
          scope: "repo,read:org",
          expires_in: 3600,
          refresh_token: "ghr_refresh_1",
        });
      }
      if (grant === "refresh_token") {
        state.refreshCalls.push(Object.fromEntries(body));
        return json({
          access_token: "gho_refreshed_access_2",
          token_type: "bearer",
          scope: "repo,read:org",
          expires_in: 3600,
          refresh_token: "ghr_refresh_2",
        });
      }
      if (grant === "authorization_code") {
        // Prove the PKCE binding: the verifier the engine sends must hash to
        // the challenge it published in the authorize URL.
        const verifier = body.get("code_verifier") ?? "";
        const hashed = createHash("sha256").update(verifier).digest("base64url");
        if (body.get("code") !== "pkce-code-1" || hashed !== state.pkceChallenge) {
          return json({ error: "invalid_grant" });
        }
        state.issuedTokens.push("gho_pkce_access_1");
        return json({
          access_token: "gho_pkce_access_1",
          token_type: "bearer",
          scope: "repo read:org",
        });
      }
      return json({ error: "unsupported_grant_type" });
    }
    if (url.pathname === "/user") {
      const authorization = request.headers.get("authorization") ?? "";
      return authorization.startsWith("Bearer gho_")
        ? json({ login: "octocat" })
        : new Response("", { status: 401 });
    }
    return new Response("", { status: 404 });
  },
});

const base = `http://127.0.0.1:${mock.port}`;

const mockDefinition = (kind: "oauth-device" | "oauth-pkce"): OAuthConnectorAuthDefinition => ({
  kind,
  clientIdEnv: "LOCAL_STUDIO_TEST_GITHUB_CLIENT_ID",
  ...(kind === "oauth-device" ? { deviceUrl: `${base}/login/device/code` } : {}),
  ...(kind === "oauth-pkce" ? { authorizeUrl: `${base}/authorize` } : {}),
  tokenUrl: `${base}/login/oauth/access_token`,
  scopes: ["repo", "read:org"],
  tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
  identityUrl: `${base}/user`,
  identityField: "login",
  createClientUrl: `${base}/settings/applications/new`,
  setupHint: "test",
});

const depsAt = (now: number, kind: "oauth-device" | "oauth-pkce"): OAuthConnectorDependencies => ({
  fetch,
  now: () => now,
  random: randomBytes,
  definitions: { github: mockDefinition(kind) },
});

afterAll(() => mock.stop(true));

describe("oauth connector engine", () => {
  test("device flow: code shown, poll loop, persisted grant, connector row", async () => {
    await saveOAuthConnectorClient("github", "test-client-id");

    const begun = await beginOAuthConnectorAuthorization("github", depsAt(T0, "oauth-device"));
    if (begun.flow !== "device") throw new Error("expected a device flow");
    expect(begun.userCode).toBe("ABCD-1234");
    expect(begun.verificationUri).toBe(`${base}/activate`);
    const settled = oauthConnectorFlowSettled("github");

    // While the user has not typed the code, status shows the pending flow.
    const pendingStatus = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-device"));
    expect(pendingStatus.connected).toBe(false);
    expect(pendingStatus.pending?.userCode).toBe("ABCD-1234");

    state.allowDeviceGrant = true;
    await settled;

    const status = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-device"));
    expect(status.connected).toBe(true);
    expect(status.account).toBe("octocat");
    expect(status.scopes).toEqual(["repo", "read:org"]);
    expect(status.pending).toBeNull();
    // The provider answered authorization_pending at least twice first.
    expect(state.devicePolls).toBeGreaterThanOrEqual(3);
  });

  test("token store is 0600 and holds the refresh token, which status never returns", async () => {
    const file = resolveOAuthTokensFilePath();
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain("gho_device_access_1");
    expect(raw).toContain("ghr_refresh_1");
    const status = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-device"));
    expect(JSON.stringify(status)).not.toContain("gho_device_access_1");
    expect(JSON.stringify(status)).not.toContain("ghr_refresh_1");
  });

  test("connecting rewrote the connector row: oauth reference, no token env, disabled", async () => {
    const row = (await listConnectors()).find((entry) => entry.id === "github");
    expect(row).toBeDefined();
    expect(row?.auth).toEqual({ type: "oauth", provider: "github", account: "octocat" });
    expect(row?.command).toBe("npx");
    expect(row?.enabled).toBe(false);
    expect(row?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBeUndefined();
    expect(row?.name).toBe("GitHub · octocat");
  });

  test("spawn env injection at the pool: access token in, refresh token out", async () => {
    const row = (await listConnectors()).find((entry) => entry.id === "github");
    if (!row) throw new Error("github row missing");
    const target = await resolveConnectorTarget(row, undefined, depsAt(T0, "oauth-device"));
    if (target.transport !== "stdio") throw new Error("expected a stdio target");
    expect(target.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("gho_device_access_1");
    expect(JSON.stringify(target)).not.toContain("ghr_refresh_1");
  });

  test("a row that claims the provider under another id gets nothing injected", async () => {
    const impostor: ConnectorConfig = {
      id: "not-github",
      name: "impostor",
      transport: "stdio",
      command: "env",
      auth: { type: "oauth", provider: "github", account: "octocat" },
      enabled: true,
    };
    expect(await oauthConnectorSpawnEnv(impostor, depsAt(T0, "oauth-device"))).toEqual({});
  });

  test("silent refresh: an expiring token is exchanged and the rotation is stored", async () => {
    // 30 seconds before expiry — inside the 60-second refresh window.
    const nearExpiry = T0 + HOUR - 30_000;
    const token = await freshOAuthConnectorAccessToken("github", depsAt(nearExpiry, "oauth-device"));
    expect(token).toBe("gho_refreshed_access_2");
    expect(state.refreshCalls).toHaveLength(1);
    expect(state.refreshCalls[0]?.refresh_token).toBe("ghr_refresh_1");
    const raw = readFileSync(resolveOAuthTokensFilePath(), "utf8");
    expect(raw).toContain("ghr_refresh_2");
    expect(raw).not.toContain("ghr_refresh_1");
    // The next spawn inside the new token's lifetime injects it unchanged.
    const row = (await listConnectors()).find((entry) => entry.id === "github");
    if (!row) throw new Error("github row missing");
    const target = await resolveConnectorTarget(row, undefined, depsAt(nearExpiry, "oauth-device"));
    if (target.transport !== "stdio") throw new Error("expected a stdio target");
    expect(target.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("gho_refreshed_access_2");
    expect(state.refreshCalls).toHaveLength(1);
  });

  test("a declined device flow reports its failure and leaves the old grant alone", async () => {
    state.denyDeviceGrant = true;
    await beginOAuthConnectorAuthorization("github", depsAt(T0, "oauth-device"));
    await oauthConnectorFlowSettled("github");
    state.denyDeviceGrant = false;
    const status = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-device"));
    expect(status.error).toContain("declined");
    expect(status.connected).toBe(true);
  });

  test("disconnect destroys the grant and strips the row's oauth reference", async () => {
    const status = await disconnectOAuthConnector("github");
    expect(status.connected).toBe(false);
    expect(status.account).toBeNull();
    const raw = readFileSync(resolveOAuthTokensFilePath(), "utf8");
    expect(raw).not.toContain("gho_");
    expect(raw).not.toContain("ghr_");
    const row = (await listConnectors()).find((entry) => entry.id === "github");
    expect(row?.auth).toBeUndefined();
    expect(row?.enabled).toBe(false);
    await expect(
      freshOAuthConnectorAccessToken("github", depsAt(T0, "oauth-device")),
    ).rejects.toThrow("not connected");
  });

  test("pkce loopback: authorize URL carries S256, the callback exchange verifies it", async () => {
    const begun = await beginOAuthConnectorAuthorization("github", depsAt(T0, "oauth-pkce"));
    if (begun.flow !== "pkce") throw new Error("expected a pkce flow");
    const authorize = new URL(begun.authorizeUrl);
    expect(authorize.origin).toBe(base);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("client_id")).toBe("test-client-id");
    const redirectUri = authorize.searchParams.get("redirect_uri") ?? "";
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    state.pkceChallenge = authorize.searchParams.get("code_challenge");

    // Play the provider's part: redirect the "browser" to the loopback with a
    // wrong state first (rejected), then the real one (exchanged).
    const forged = await fetch(`${redirectUri}?state=wrong&code=pkce-code-1`);
    expect(forged.status).toBe(400);

    const begunAgain = await beginOAuthConnectorAuthorization("github", depsAt(T0, "oauth-pkce"));
    if (begunAgain.flow !== "pkce") throw new Error("expected a pkce flow");
    const authorizeAgain = new URL(begunAgain.authorizeUrl);
    state.pkceChallenge = authorizeAgain.searchParams.get("code_challenge");
    const redirectAgain = authorizeAgain.searchParams.get("redirect_uri") ?? "";
    const callback = await fetch(
      `${redirectAgain}?state=${encodeURIComponent(
        authorizeAgain.searchParams.get("state") ?? "",
      )}&code=pkce-code-1`,
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("connected");

    const status = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-pkce"));
    expect(status.connected).toBe(true);
    expect(status.account).toBe("octocat");
  });

  test("replacing the client id drops the grant it cannot outlive", async () => {
    await saveOAuthConnectorClient("github", "another-client-id");
    const status = await getOAuthConnectorStatus("github", depsAt(T0, "oauth-device"));
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
  });

  test("unknown connectors are refused", async () => {
    await expect(beginOAuthConnectorAuthorization("nope")).rejects.toThrow("not an OAuth-capable");
  });
});
