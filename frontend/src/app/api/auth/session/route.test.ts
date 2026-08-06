import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as exchangeSession } from "@/app/api/auth/session/route";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  resolveAccessPostureFromEnvironment,
  type AccessEnvironment,
} from "@/lib/auth/access";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxy } from "@/proxy";

const accessVariables = [
  "NODE_ENV",
  "HOSTNAME",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DESKTOP",
  "LOCAL_STUDIO_FRONTEND_TOKEN",
  "LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED",
  "ALLOWED_TAILSCALE_HOSTS",
  "ALLOWED_TAILSCALE_USERS",
] as const;
const originalEnvironment = Object.fromEntries(
  accessVariables.map((name) => [name, process.env[name]]),
);

function accessRequest(
  input: ConstructorParameters<typeof NextRequest>[0],
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  const headers = new Headers(init?.headers);
  const url = typeof input === "string" || input instanceof URL ? input : input.url;
  if (!headers.has("host")) headers.set("host", new URL(url).host);
  return new NextRequest(input, { ...init, headers });
}

function productionEnvironment(values: AccessEnvironment = {}): void {
  for (const name of accessVariables) delete process.env[name];
  Object.assign(process.env, {
    NODE_ENV: "production",
    ALLOWED_TAILSCALE_HOSTS: "studio.example",
    ...values,
  });
}

afterEach(() => {
  for (const name of accessVariables) delete process.env[name];
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value !== undefined) process.env[name] = value;
  }
});

test("access posture encodes the production trust matrix", () => {
  const rows: ReadonlyArray<readonly [AccessEnvironment, unknown]> = [
    [{ NODE_ENV: "development" }, { kind: "allow", reason: "development" }],
    [
      { NODE_ENV: "production", LOCAL_STUDIO_DESKTOP: "1", HOSTNAME: "127.0.0.1" },
      { kind: "allow", reason: "desktop" },
    ],
    [
      { NODE_ENV: "production", LOCAL_STUDIO_DESKTOP: "1", HOSTNAME: "0.0.0.0" },
      {
        kind: "configuration-error",
        message: "Desktop mode requires HOSTNAME to be an explicit loopback address.",
      },
    ],
    [
      {
        NODE_ENV: "production",
        LOCAL_STUDIO_DATA_DIR: "/tmp/data",
        LOCAL_STUDIO_FRONTEND_TOKEN: " secret ",
      },
      { kind: "require-token", token: "secret" },
    ],
    [
      { NODE_ENV: "production", LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true" },
      { kind: "allow", reason: "explicit-unauthenticated" },
    ],
  ];
  for (const [environment, expected] of rows) {
    assert.deepEqual(resolveAccessPostureFromEnvironment(environment), expected);
  }
  assert.equal(
    resolveAccessPostureFromEnvironment({
      NODE_ENV: "production",
      LOCAL_STUDIO_DATA_DIR: "/tmp/data",
    }).kind,
    "configuration-error",
  );
  assert.equal(
    resolveAccessPostureFromEnvironment({
      NODE_ENV: "production",
      LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "1",
    }).kind,
    "configuration-error",
  );
});

test("middleware rejects query tokens and permits only the POST exchange", () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const queryResponse = proxy(accessRequest("https://studio.example/agent?safe=1&token=secret"));
  assert.equal(queryResponse.status, 303);
  assert.equal(queryResponse.headers.get("location"), "https://studio.example/agent?safe=1");
  assert.equal(queryResponse.headers.has("set-cookie"), false);
  assert.equal(
    proxy(accessRequest("https://studio.example/api/agent/terminal?token=secret")).status,
    400,
  );
  assert.equal(proxy(accessRequest("https://studio.example/api/agent/terminal")).status, 401);
  assert.equal(proxy(accessRequest("https://studio.example/agent")).status, 303);
  assert.equal(proxy(accessRequest("https://studio.example/access")).status, 200);
  assert.equal(proxy(accessRequest("https://studio.example/api/auth/session")).status, 401);
  assert.equal(
    proxy(
      accessRequest("https://studio.example/api/auth/session", {
        method: "POST",
        headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      }),
    ).status,
    403,
  );
  assert.equal(
    proxy(
      accessRequest("https://studio.example/api/agent/terminal", {
        headers: { [STUDIO_TOKEN_HEADER]: "secret" },
      }),
    ).status,
    200,
  );
  assert.equal(
    proxy(
      accessRequest("https://studio.example/api/auth/session", {
        method: "POST",
        headers: { origin: "https://studio.example", "sec-fetch-site": "same-origin" },
        body: new URLSearchParams({ token: "secret" }),
      }),
    ).status,
    200,
  );
});

test("POST exchange and Node guards share the fail-closed posture", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const response = await exchangeSession(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams({ token: "secret" }),
    }),
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.match(cookie, new RegExp(`^${STUDIO_TOKEN_COOKIE}=secret`));
  assert.match(cookie, /HttpOnly/iu);
  assert.match(cookie, /Secure/iu);
  assert.equal(
    requireApiAccess(
      accessRequest("https://studio.example/api/agent/terminal", {
        headers: { cookie: cookie.split(";", 1)[0] ?? "" },
      }),
    ),
    null,
  );
  const invalid = await exchangeSession(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams({ token: "wrong" }),
    }),
  );
  assert.equal(invalid.status, 303);
  assert.equal(invalid.headers.get("location"), "/access?error=invalid");
  assert.equal(invalid.headers.has("set-cookie"), false);
  const oversized = await exchangeSession(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams({ token: "x".repeat(5_000) }),
    }),
  );
  assert.equal(oversized.status, 413);
  productionEnvironment();
  assert.equal(
    requireApiAccess(accessRequest("https://studio.example/api/agent/terminal"))?.status,
    503,
  );
});

test("current standalone startup rejects unsafe production before build or bind", () => {
  const repositoryRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const environment = { ...process.env };
  for (const name of accessVariables) delete environment[name];
  Object.assign(environment, {
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    LOCAL_STUDIO_DATA_DIR: "/tmp/not-a-desktop-identity",
  });
  const result = spawnSync(process.execPath, [`${repositoryRoot}scripts/project.mjs`, "start"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 1);
  assert.match(output, /Production frontend access requires/iu);
  assert.doesNotMatch(output, /Missing "\.next\/standalone"/u);
});
