import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { GET as readPlanRoute } from "@/app/api/agent/plan/route";
import { GET as listFilesystemRoute } from "@/app/api/agent/fs/route";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { POST as runTerminalRoute } from "@/app/api/agent/terminal/route";
import { POST as runTurnRoute } from "@/app/api/agent/turn/route";
import { POST } from "@/app/api/auth/session/route";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  resolveAccessPostureFromEnvironment,
  type AccessEnvironment,
} from "@/lib/auth/access";
import {
  captureFrontendCallbackCredential,
  matchesFrontendCallbackCredential,
} from "@/lib/auth/callback-credential";
import { environmentWithoutFrontendCredentials } from "@/lib/auth/child-environment";
import { requireApiAccess, requireCallbackOrApiAccess } from "@/lib/auth/guard";
import { resolveAgentRuntimeUrl } from "@/lib/agent-runtime-url.mjs";
import { proxy } from "@/proxy";
import {
  FRONTEND_CALLBACK_TOKEN_ENV,
  FRONTEND_CALLBACK_TOKEN_HEADER,
} from "@shared/agent/frontend-callback-auth";
import {
  captureRuntimeCallbackCredential,
  createFrontendCallbackFetch,
} from "@local-studio/agent-runtime/frontend-callback-auth";
import { connectMcp } from "@local-studio/agent-runtime/mcp-client";
import { runtimeFrontendOrigin } from "../desktop/resources/pi-extensions/frontend-callback-origin";

const accessVariables = [
  "NODE_ENV",
  "HOSTNAME",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DESKTOP",
  "LOCAL_STUDIO_FRONTEND_TOKEN",
  "LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED",
  "LOCAL_STUDIO_FRONTEND_BASE",
  "LOCAL_STUDIO_AGENT_RUNTIME_URL",
  FRONTEND_CALLBACK_TOKEN_ENV,
] as const;
const originalEnvironment = Object.fromEntries(
  accessVariables.map((name) => [name, process.env[name]]),
);
const fixtureDirectories: string[] = [];

function accessRequest(
  input: ConstructorParameters<typeof NextRequest>[0],
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(input, init);
}

function streamedAccessRequest(body: string, headers: HeadersInit): NextRequest {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 512, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
  return accessRequest("https://studio.example/api/auth/session", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  });
}

function clearAccessEnvironment(): void {
  for (const name of accessVariables) delete process.env[name];
}

function productionEnvironment(values: AccessEnvironment = {}): void {
  clearAccessEnvironment();
  Object.assign(process.env, { NODE_ENV: "production" }, values);
}

function restoreEnvironment(): void {
  clearAccessEnvironment();
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value !== undefined) process.env[name] = value;
  }
}

function frontendSource(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function repositorySource(relativePath: string): string {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

function runtimeFixtureSource(): string {
  return [
    'import { spawnSync } from "node:child_process";',
    'import { createServer } from "node:http";',
    'const operatorToken = "LOCAL_STUDIO_FRONTEND_TOKEN";',
    'const descendant = spawnSync(process.execPath, ["-e", `process.stdout.write(process.env.${operatorToken} ? "present" : "absent")`], { env: process.env, encoding: "utf8" });',
    'console.log(`runtime-env:${JSON.stringify({ runtimeOperator: Boolean(process.env[operatorToken]), descendantOperator: descendant.stdout === "present" })}`);',
    "const server = createServer((request, response) => {",
    '  if (request.url !== "/health") {',
    "    response.writeHead(404).end();",
    "    return;",
    "  }",
    '  response.setHeader("content-type", "application/json");',
    '  response.end(JSON.stringify({ service: "local-studio-agent-runtime" }));',
    "});",
    'server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("runtime-started"));',
    "function stop() {",
    "  server.close(() => process.exit(0));",
    "}",
    'process.on("SIGINT", stop);',
    'process.on("SIGTERM", stop);',
  ].join("\n");
}

function createStandaloneFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "local-studio-access-startup-"));
  const frontend = join(root, "frontend");
  fixtureDirectories.push(root);
  for (const directory of [
    "scripts",
    "src/lib/auth",
    ".next/standalone",
    ".next/static",
    "public",
    "node_modules",
    "../services/agent-runtime/dist",
    "../shared/agent",
  ]) {
    mkdirSync(join(frontend, directory), { recursive: true });
  }
  copyFileSync(
    frontendSource("scripts/start-standalone.mjs"),
    join(frontend, "scripts/start-standalone.mjs"),
  );
  copyFileSync(
    frontendSource("src/lib/auth/access-posture.mjs"),
    join(frontend, "src/lib/auth/access-posture.mjs"),
  );
  copyFileSync(
    frontendSource("src/lib/agent-runtime-url.mjs"),
    join(frontend, "src/lib/agent-runtime-url.mjs"),
  );
  copyFileSync(
    repositorySource("shared/agent/frontend-environment.mjs"),
    join(root, "shared/agent/frontend-environment.mjs"),
  );
  symlinkSync(frontendSource("node_modules/dotenv"), join(frontend, "node_modules/dotenv"), "dir");
  writeFileSync(join(frontend, ".next/standalone/server.js"), 'console.log("fixture-started");\n');
  writeFileSync(join(root, "services/agent-runtime/dist/standalone.mjs"), runtimeFixtureSource());
  return frontend;
}

function availablePort(): number {
  const script = [
    'import { createServer } from "node:net";',
    "const server = createServer();",
    'server.listen(0, "127.0.0.1", () => {',
    "  const address = server.address();",
    "  process.stdout.write(String(address.port));",
    "  server.close();",
    "});",
  ].join("\n");
  const result = spawnSync(
    process.env.npm_node_execpath ?? "node",
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const port = Number(result.stdout);
  assert(Number.isInteger(port) && port > 0);
  return port;
}

type StandaloneResult = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

async function runStandalone(
  frontend: string,
  values: AccessEnvironment = {},
): Promise<StandaloneResult> {
  const environment = { ...process.env };
  for (const name of accessVariables) delete environment[name];
  Object.assign(environment, values);
  environment.LOCAL_STUDIO_AGENT_RUNTIME_URL ??= `http://127.0.0.1:${availablePort()}`;
  const child = spawn(process.env.npm_node_execpath ?? "node", ["scripts/start-standalone.mjs"], {
    cwd: frontend,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolveResult({ status, signal, stdout, stderr });
    });
  });
}

async function healthyRuntime(): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ service: "local-studio-agent-runtime" }));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    url: `http://127.0.0.1:${address.port}`,
  };
}

function executable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function createDeployFixture(): { log: string; remote: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "local-studio-deploy-lifecycle-"));
  const fakeBin = join(root, "bin");
  const log = join(root, "commands.log");
  const remote = join(root, "remote");
  fixtureDirectories.push(root);
  for (const directory of [
    "scripts",
    "frontend/.next",
    "frontend/scripts",
    "frontend/src",
    "services/agent-runtime/dist",
    "shared/agent",
    "controller/src",
    "controller/contracts",
    "remote/frontend/node_modules",
    "bin",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(
    repositorySource("scripts/deploy-remote.sh"),
    join(root, "scripts/deploy-remote.sh"),
  );
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) {
    writeFileSync(join(root, "frontend", file), "{}\n");
  }
  for (const [source, destination] of [
    ["scripts/start-standalone.mjs", "frontend/scripts/start-standalone.mjs"],
    ["src/lib/agent-runtime-url.mjs", "frontend/src/lib/agent-runtime-url.mjs"],
    ["src/lib/auth/access-posture.mjs", "frontend/src/lib/auth/access-posture.mjs"],
  ]) {
    mkdirSync(join(root, destination, ".."), { recursive: true });
    copyFileSync(frontendSource(source), join(root, destination));
  }
  copyFileSync(
    repositorySource("shared/agent/frontend-environment.mjs"),
    join(root, "shared/agent/frontend-environment.mjs"),
  );
  symlinkSync(
    frontendSource("node_modules/dotenv"),
    join(remote, "frontend/node_modules/dotenv"),
    "dir",
  );
  writeFileSync(join(root, "services/agent-runtime/dist/standalone.mjs"), "export {};\n");
  writeFileSync(log, "");
  executable(
    join(fakeBin, "npm"),
    '#!/usr/bin/env bash\nprintf \'npm %s\\n\' "$*" >> "$DEPLOY_LOG"\n',
  );
  executable(
    join(fakeBin, "rsync"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf \'rsync %s\\n\' "$*" >> "$DEPLOY_LOG"',
      'for argument in "$@"; do',
      '  case "$argument" in',
      "    frontend/src/|frontend/scripts/|frontend/desktop/resources/|shared/)",
      '      destination="$DEPLOY_REMOTE_ROOT/${argument%/}"',
      '      mkdir -p "$destination"',
      '      cp -R "${argument}." "$destination/"',
      "      ;;",
      "    frontend/package.json|frontend/package-lock.json|frontend/tsconfig.json|frontend/next.config.ts|frontend/tailwind.config.ts|frontend/postcss.config.mjs)",
      '      mkdir -p "$DEPLOY_REMOTE_ROOT/frontend"',
      '      cp "$argument" "$DEPLOY_REMOTE_ROOT/frontend/"',
      "      ;;",
      "    services/agent-runtime/dist/standalone.mjs)",
      '      mkdir -p "$DEPLOY_REMOTE_ROOT/services/agent-runtime/dist"',
      '      cp "$argument" "$DEPLOY_REMOTE_ROOT/services/agent-runtime/dist/"',
      "      ;;",
      "  esac",
      "done",
    ].join("\n"),
  );
  executable(
    join(fakeBin, "ssh"),
    [
      "#!/usr/bin/env bash",
      'printf \'ssh %s\\n\' "$*" >> "$DEPLOY_LOG"',
      "payload=$(cat)",
      'if [[ -n "$payload" ]]; then',
      '  printf \'payload-start\\n%s\\npayload-end\\n\' "$payload" >> "$DEPLOY_LOG"',
      "fi",
    ].join("\n"),
  );
  return { log, remote, root };
}

function runDeployFixture(root: string, log: string, command: string): string {
  writeFileSync(log, "");
  const result = spawnSync("bash", ["scripts/deploy-remote.sh", command], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DEPLOY_LOG: log,
      DEPLOY_REMOTE_ROOT: join(root, "remote"),
      PATH: `${join(root, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      REMOTE_HOST: "host.invalid",
      REMOTE_PATH: "/srv/local-studio",
      REMOTE_SSH_KEY: join(root, "id_ed25519"),
      REMOTE_USER: "deploy",
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return readFileSync(log, "utf8");
}

afterEach(() => {
  captureFrontendCallbackCredential({});
  restoreEnvironment();
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("access posture encodes every production trust boundary", () => {
  const rows = [
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
      { NODE_ENV: "production", LOCAL_STUDIO_FRONTEND_TOKEN: "secret" },
      { kind: "require-token", token: "secret" },
    ],
    [
      {
        NODE_ENV: "production",
        LOCAL_STUDIO_DATA_DIR: "/tmp/data",
        LOCAL_STUDIO_FRONTEND_TOKEN: "secret",
      },
      { kind: "require-token", token: "secret" },
    ],
    [
      {
        NODE_ENV: "production",
        LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
      },
      { kind: "allow", reason: "explicit-unauthenticated" },
    ],
  ] as const;
  for (const [environment, expected] of rows) {
    assert.deepEqual(resolveAccessPostureFromEnvironment(environment), expected);
  }
  assert.equal(
    resolveAccessPostureFromEnvironment({ NODE_ENV: "production" }).kind,
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

test("agent runtime URL boundary normalizes only supported base origins", () => {
  assert.deepEqual(resolveAgentRuntimeUrl(undefined), {
    ok: true,
    url: "http://127.0.0.1:8081",
    hostname: "127.0.0.1",
    port: "8081",
  });
  assert.deepEqual(resolveAgentRuntimeUrl(" HTTP://LOCALHOST:8081/ "), {
    ok: true,
    url: "http://localhost:8081",
    hostname: "localhost",
    port: "8081",
  });
  assert.deepEqual(resolveAgentRuntimeUrl("https://runtime.example:443/"), {
    ok: true,
    url: "https://runtime.example",
    hostname: "runtime.example",
    port: "",
  });
  for (const value of [
    "invalid",
    "ftp://runtime.example",
    "http://operator:secret@127.0.0.1:8081",
    "http://127.0.0.1:8081/path",
    "http://127.0.0.1:8081?",
    "http://127.0.0.1:8081#",
  ]) {
    assert.deepEqual(resolveAgentRuntimeUrl(value), {
      ok: false,
      error: "Agent runtime URL configuration is invalid.",
    });
  }
});

test("middleware rejects query tokens and routes browser authentication through access", () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const queryResponse = proxy(
    accessRequest(
      "https://studio.example/agent?safe=1&token=secret&api_key=a&key=b&access_token=c",
    ),
  );
  assert.equal(queryResponse.status, 303);
  assert.equal(queryResponse.headers.get("location"), "https://studio.example/agent?safe=1");
  assert.equal(queryResponse.headers.has("set-cookie"), false);

  const authenticatedHeaders: HeadersInit[] = [
    { [STUDIO_TOKEN_HEADER]: "secret" },
    { cookie: `${STUDIO_TOKEN_COOKIE}=secret` },
  ];
  for (const headers of authenticatedHeaders) {
    const authenticatedCleanup = proxy(
      accessRequest("https://studio.example/agent?token=discarded&safe=1", { headers }),
    );
    assert.equal(authenticatedCleanup.status, 303);
    assert.equal(
      authenticatedCleanup.headers.get("location"),
      "https://studio.example/agent?safe=1",
    );
  }

  const rejectedPostQuery = proxy(
    accessRequest("https://studio.example/api/agent/turn?token=discarded", {
      method: "POST",
      headers: { [STUDIO_TOKEN_HEADER]: "secret" },
    }),
  );
  assert.equal(rejectedPostQuery.status, 400);
  const rejectedApiQuery = proxy(
    accessRequest("https://studio.example/api/agent/runtime/status?token=discarded", {
      headers: { [STUDIO_TOKEN_HEADER]: "secret" },
    }),
  );
  assert.equal(rejectedApiQuery.status, 400);

  const apiResponse = proxy(accessRequest("https://studio.example/api/agent/terminal"));
  assert.equal(apiResponse.status, 401);

  const accessResponse = proxy(accessRequest("https://studio.example/access"));
  assert.equal(accessResponse.status, 200);

  const authenticatedResponse = proxy(
    accessRequest("https://studio.example/agent", {
      headers: { "x-local-studio-token": "secret" },
    }),
  );
  assert.equal(authenticatedResponse.status, 200);
});

test("middleware and session exchange preserve invalid and explicit postures", async () => {
  productionEnvironment();
  const invalidApi = proxy(accessRequest("https://studio.example/api/agent/terminal"));
  assert.equal(invalidApi.status, 503);
  assert.deepEqual(await invalidApi.json(), {
    error:
      "Production frontend access requires LOCAL_STUDIO_FRONTEND_TOKEN or LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED=true.",
  });
  const invalidPage = proxy(accessRequest("https://studio.example/agent"));
  assert.equal(invalidPage.status, 503);
  const invalidSession = await POST(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams({ token: "secret" }),
    }),
  );
  assert.equal(invalidSession.status, 503);

  productionEnvironment({ LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true" });
  assert.equal(proxy(accessRequest("https://studio.example/api/agent/terminal")).status, 200);
  const allowedSession = await POST(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams(),
    }),
  );
  assert.equal(allowedSession.status, 303);
  assert.equal(allowedSession.headers.get("location"), "/");
  assert.equal(allowedSession.headers.has("set-cookie"), false);
});

test("POST token exchange sets only the HttpOnly access cookie", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const request = accessRequest("https://studio.example/api/auth/session", {
    method: "POST",
    body: new URLSearchParams({ token: "secret" }),
  });
  const response = await POST(request);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.match(cookie, new RegExp(`^${STUDIO_TOKEN_COOKIE}=secret`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  const cookiePair = cookie.split(";", 1)[0] ?? "";
  const authenticated = accessRequest("https://studio.example/api/agent/terminal", {
    headers: { cookie: cookiePair },
  });
  assert.equal(proxy(authenticated).status, 200);
  assert.equal(requireApiAccess(authenticated), null);
});

test("invalid POST token does not create a session", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const response = await POST(
    accessRequest("https://studio.example/api/auth/session", {
      method: "POST",
      body: new URLSearchParams({ token: "wrong" }),
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/access?error=invalid");
  assert.equal(response.headers.has("set-cookie"), false);
});

test("POST token exchange bounds streaming form bodies before parsing", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const marker = "access-form-overflow-marker";
  const body = `token=${marker}${"x".repeat(8_192)}`;
  const framingHeaders: ReadonlyArray<Readonly<Record<string, string>>> = [
    { "transfer-encoding": "chunked" },
    {},
    { "content-length": "false" },
    { "content-length": "1" },
  ];
  for (const framing of framingHeaders) {
    const response = await POST(
      streamedAccessRequest(body, {
        "content-type": "application/x-www-form-urlencoded",
        ...framing,
      }),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.text()).includes(marker), false);
  }
});

test("POST token exchange accepts only bounded UTF-8 urlencoded forms", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const accepted = await POST(
    streamedAccessRequest("token=secret", {
      "content-type": 'application/x-www-form-urlencoded; charset="UTF-8"',
    }),
  );
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/");
  assert.match(accepted.headers.get("set-cookie") ?? "", new RegExp(`^${STUDIO_TOKEN_COOKIE}=`));

  const marker = "multipart-access-token-marker";
  const multipart = [
    "--fixture",
    'Content-Disposition: form-data; name="token"',
    "",
    marker,
    "--fixture",
    'Content-Disposition: form-data; name="padding"',
    "",
    "x".repeat(8_192),
    "--fixture--",
    "",
  ].join("\r\n");
  const unsupported = [
    streamedAccessRequest(multipart, {
      "content-type": "multipart/form-data; boundary=fixture",
    }),
    streamedAccessRequest(JSON.stringify({ token: marker }), {
      "content-type": "application/json",
    }),
  ];
  for (const request of unsupported) {
    const response = await POST(request);
    assert.equal(response.status, 415);
    assert.equal((await response.text()).includes(marker), false);
  }
});

test("POST token exchange never redirects to a standalone bind address", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const response = await POST(
    accessRequest("https://0.0.0.0:39777/api/auth/session", {
      method: "POST",
      headers: { host: "studio.example", "x-forwarded-proto": "https" },
      body: new URLSearchParams({ token: "secret" }),
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
});

test("Node route guard fails closed independently of middleware", () => {
  productionEnvironment();
  const configurationResponse = requireApiAccess(
    accessRequest("https://studio.example/api/agent/terminal"),
  );
  assert.equal(configurationResponse?.status, 503);

  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "secret" });
  const denied = requireApiAccess(accessRequest("https://studio.example/api/agent/terminal"));
  assert.equal(denied?.status, 401);
  const allowed = requireApiAccess(
    accessRequest("https://studio.example/api/agent/terminal", {
      headers: { "x-local-studio-token": "secret" },
    }),
  );
  assert.equal(allowed, null);
});

test("internal callback credential is accepted only by exact callback routes", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "operator-secret" });
  const callbackEnvironment: AccessEnvironment = {
    [FRONTEND_CALLBACK_TOKEN_ENV]: "callback-secret",
  };
  captureFrontendCallbackCredential(callbackEnvironment);
  assert.equal(callbackEnvironment[FRONTEND_CALLBACK_TOKEN_ENV], undefined);

  const callbackHeaders = { [FRONTEND_CALLBACK_TOKEN_HEADER]: "callback-secret" };
  const planRequest = accessRequest("https://studio.example/api/agent/plan?sessionId=auth-test", {
    headers: callbackHeaders,
  });
  assert.equal(matchesFrontendCallbackCredential(planRequest), true);
  assert.equal(proxy(planRequest).status, 200);
  assert.equal((await readPlanRoute(planRequest)).status, 200);

  for (const token of [undefined, "wrong-secret"]) {
    const request = accessRequest("https://studio.example/api/agent/plan", {
      headers: token ? { [FRONTEND_CALLBACK_TOKEN_HEADER]: token } : undefined,
    });
    assert.equal((await readPlanRoute(request)).status, 401);
  }

  for (const url of [
    "https://studio.example/api/agent/canvas",
    "https://studio.example/api/agent/connectors/call",
    "https://studio.example/api/agent/browser/navigate",
  ]) {
    assert.equal(
      requireCallbackOrApiAccess(accessRequest(url, { method: "POST", headers: callbackHeaders })),
      null,
    );
  }
  for (const verb of ["unknown", "back", "forward", "reload"]) {
    assert.equal(
      requireCallbackOrApiAccess(
        accessRequest(`https://studio.example/api/agent/browser/${verb}`, {
          method: "POST",
          headers: callbackHeaders,
        }),
      )?.status,
      401,
    );
  }

  assert.equal(
    requireCallbackOrApiAccess(
      accessRequest("https://studio.example/api/agent/browser/navigate", {
        method: "GET",
        headers: callbackHeaders,
      }),
    )?.status,
    401,
  );

  const terminal = await runTerminalRoute(
    accessRequest("https://studio.example/api/agent/terminal?cwd=/private/tmp", {
      method: "POST",
      headers: callbackHeaders,
      body: JSON.stringify({ command: "true" }),
    }),
  );
  assert.equal(terminal.status, 401);
  const filesystem = await listFilesystemRoute(
    accessRequest("https://studio.example/api/agent/fs?cwd=/private/tmp", {
      headers: callbackHeaders,
    }),
  );
  assert.equal(filesystem.status, 401);
  const turn = await runTurnRoute(
    accessRequest("https://studio.example/api/agent/turn", {
      method: "POST",
      headers: callbackHeaders,
      body: "{}",
    }),
  );
  assert.equal(turn.status, 401);
  assert.equal(
    proxy(
      accessRequest("https://studio.example/api/agent/terminal", {
        method: "POST",
        headers: callbackHeaders,
      }),
    ).status,
    401,
  );
});

test("runtime callback state is scrubbed from descendants and scoped fetches", async () => {
  const environment: NodeJS.ProcessEnv = {
    [FRONTEND_CALLBACK_TOKEN_ENV]: "callback-secret",
    LOCAL_STUDIO_FRONTEND_BASE: "https://studio.example",
    NODE_ENV: "test",
  };
  const credential = captureRuntimeCallbackCredential(environment);
  assert.equal(environment[FRONTEND_CALLBACK_TOKEN_ENV], undefined);
  assert.equal(environment.LOCAL_STUDIO_FRONTEND_BASE, undefined);
  const descendant = spawnSync(
    process.execPath,
    [
      "-e",
      `process.stdout.write(process.env.${FRONTEND_CALLBACK_TOKEN_ENV} ? "present" : "absent")`,
    ],
    { env: environment, encoding: "utf8" },
  );
  assert.equal(descendant.status, 0, descendant.stderr);
  assert.equal(descendant.stdout, "absent");

  const observed: Array<{ url: string; callback: string | null }> = [];
  const recordingFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    observed.push({
      url: request.url,
      callback: request.headers.get(FRONTEND_CALLBACK_TOKEN_HEADER),
    });
    return new Response(null, { status: 204 });
  }) satisfies typeof fetch;
  const callbackFetch = createFrontendCallbackFetch(credential, recordingFetch);
  await callbackFetch("https://studio.example/api/agent/plan");
  await callbackFetch("https://studio.example/api/agent/connectors/call", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/browser/navigate", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/terminal", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/browser/unknown", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/browser/back", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/browser/forward", { method: "POST" });
  await callbackFetch("https://studio.example/api/agent/browser/reload", { method: "POST" });
  await callbackFetch("https://other.example/api/agent/plan");
  assert.deepEqual(
    observed.map(({ callback }) => callback),
    ["callback-secret", "callback-secret", "callback-secret", null, null, null, null, null, null],
  );
});

test("runtime capture scrubs reserved frontend state before direct descendants", () => {
  const operatorMarker = "operator-descendant-marker";
  const callbackMarker = "callback-descendant-marker";
  Object.assign(process.env, {
    LOCAL_STUDIO_DESKTOP: "1",
    LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
    LOCAL_STUDIO_FRONTEND_BASE: "https://studio.example",
    LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN: callbackMarker,
    LOCAL_STUDIO_FRONTEND_TOKEN: operatorMarker,
  });
  const credential = captureRuntimeCallbackCredential(process.env);
  assert.deepEqual(credential, {
    frontendOrigin: "https://studio.example",
    token: callbackMarker,
  });
  assert.equal(runtimeFrontendOrigin(), "https://studio.example");

  const names = [
    "LOCAL_STUDIO_DESKTOP",
    "LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED",
    "LOCAL_STUDIO_FRONTEND_BASE",
    "LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN",
    "LOCAL_STUDIO_FRONTEND_TOKEN",
  ];
  for (const name of names) assert.equal(process.env[name], undefined);
  const script = [
    `const names = ${JSON.stringify(names)};`,
    "const values = Object.fromEntries(names.map((name) => [name, process.env[name]]).filter(([, value]) => value));",
    "process.stdout.write(JSON.stringify(values));",
    'process.stderr.write(Object.values(values).join("|"));',
  ].join("\n");
  const descendant = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(descendant.status, 0, descendant.stderr);
  assert.equal(descendant.stdout, "{}");
  assert.equal(descendant.stderr, "");
  assert.equal(`${descendant.stdout}${descendant.stderr}`.includes(operatorMarker), false);
  assert.equal(`${descendant.stdout}${descendant.stderr}`.includes(callbackMarker), false);
});

test("stdio MCP environment cannot reintroduce reserved frontend credentials", async () => {
  const operatorMarker = "operator-mcp-marker";
  const callbackMarker = "callback-mcp-marker";
  const script = [
    'const names = ["LOCAL_STUDIO_DESKTOP", "LOCAL_STUDIO_FRONTEND_BASE", "LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN", "LOCAL_STUDIO_FRONTEND_TOKEN"];',
    'process.stdin.once("data", () => {',
    "  const leaked = names.map((name) => process.env[name]).filter(Boolean);",
    '  process.stderr.write(`probe:${leaked.join("|") || "scrubbed"}\\n`, () => process.exit(1));',
    "});",
  ].join("\n");
  const connection = connectMcp({
    transport: "stdio",
    command: process.execPath,
    args: ["--input-type=module", "-e", script],
    env: {
      LOCAL_STUDIO_DESKTOP: "1",
      LOCAL_STUDIO_FRONTEND_BASE: "https://studio.example",
      LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN: callbackMarker,
      LOCAL_STUDIO_FRONTEND_TOKEN: operatorMarker,
    },
  });
  try {
    await assert.rejects(connection.listTools(), (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /probe:scrubbed/);
      assert.equal(error.message.includes(operatorMarker), false);
      assert.equal(error.message.includes(callbackMarker), false);
      return true;
    });
  } finally {
    connection.close();
  }
});

test("runtime proxy never forwards frontend credentials", async () => {
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "operator-secret" });
  let forwarded: Request | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    forwarded = new Request(input, init);
    return Response.json({ ok: true });
  }) satisfies typeof fetch;
  try {
    const response = await proxyToAgentRuntime(
      accessRequest("https://studio.example/api/agent/browser/navigate", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer controller-secret",
          [FRONTEND_CALLBACK_TOKEN_HEADER]: "callback-secret",
          "content-type": "application/json",
          cookie: `${STUDIO_TOKEN_COOKIE}=operator-secret`,
          "last-event-id": "42",
          origin: "https://studio.example",
          referer: "https://studio.example/agent?token=operator-secret",
          [STUDIO_TOKEN_HEADER]: "operator-secret",
          "x-request-marker": "discarded",
        },
        body: "{}",
      }),
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(forwarded);
  assert.equal(forwarded.headers.get(FRONTEND_CALLBACK_TOKEN_HEADER), null);
  assert.equal(forwarded.headers.get(STUDIO_TOKEN_HEADER), null);
  assert.equal(forwarded.headers.get("authorization"), null);
  assert.equal(forwarded.headers.get("cookie"), null);
  assert.equal(forwarded.headers.get("origin"), null);
  assert.equal(forwarded.headers.get("referer"), null);
  assert.equal(forwarded.headers.get("x-request-marker"), null);
  assert.equal(forwarded.headers.get("accept"), "application/json");
  assert.equal(forwarded.headers.get("content-type"), "application/json");
  assert.equal(forwarded.headers.get("last-event-id"), "42");
});

test("runtime proxy rejects invalid configuration and redacts fetch failures", async () => {
  const configurationMarker = "runtime-config-secret-marker";
  productionEnvironment({ LOCAL_STUDIO_FRONTEND_TOKEN: "operator-secret" });
  process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = `not-a-url-${configurationMarker}`;
  const invalid = await proxyToAgentRuntime(
    accessRequest("https://studio.example/api/agent/runtime/status", {
      headers: { [STUDIO_TOKEN_HEADER]: "operator-secret" },
    }),
  );
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.text()).includes(configurationMarker), false);

  const fetchMarker = "runtime-fetch-secret-marker";
  process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = "https://runtime-marker.example";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error(fetchMarker);
  }) satisfies typeof fetch;
  try {
    const unavailable = await proxyToAgentRuntime(
      accessRequest("https://studio.example/api/agent/runtime/status", {
        headers: { [STUDIO_TOKEN_HEADER]: "operator-secret" },
      }),
    );
    const body = await unavailable.text();
    assert.equal(unavailable.status, 502);
    assert.equal(body.includes(fetchMarker), false);
    assert.equal(body.includes("runtime-marker"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("frontend child environments never inherit frontend credentials", () => {
  const environment: NodeJS.ProcessEnv = {
    LOCAL_STUDIO_DESKTOP: "1",
    LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
    LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN: "callback-secret",
    LOCAL_STUDIO_FRONTEND_TOKEN: "operator-secret",
    NODE_ENV: "test",
    PATH: "/usr/bin",
  };
  const childEnvironment = environmentWithoutFrontendCredentials(environment);
  assert.deepEqual(childEnvironment, { NODE_ENV: "test", PATH: "/usr/bin" });
  assert.equal(environment.LOCAL_STUDIO_FRONTEND_TOKEN, "operator-secret");
});

test("standalone syntax, dotenv import, and quality script stay wired", () => {
  const syntax = spawnSync(
    process.env.npm_node_execpath ?? "node",
    ["--check", frontendSource("scripts/start-standalone.mjs")],
    { encoding: "utf8" },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
  const packageJson = JSON.parse(readFileSync(frontendSource("package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.dotenv, "16.6.1");
  assert.equal(
    packageJson.scripts?.["test:access-control"],
    "bun test tests/access-control.test.ts",
  );
  assert.match(packageJson.scripts?.["check:quality"] ?? "", /test:access-control/);
});

test("standalone startup rejects unsafe production before spawning", async () => {
  const result = await runStandalone(createStandaloneFixture());
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /Production frontend access requires/);
  assert.equal(result.stdout.includes("runtime-started"), false);
  assert.equal(result.stdout.includes("fixture-started"), false);
});

test("token-gated standalone never reuses an uncredentialed healthy runtime", async () => {
  const runtime = await healthyRuntime();
  try {
    const tokenGated = await runStandalone(createStandaloneFixture(), {
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtime.url,
      LOCAL_STUDIO_FRONTEND_TOKEN: "secret",
    });
    assert.equal(tokenGated.status, 1);
    assert.match(tokenGated.stderr, /frontend-owned loopback agent runtime/);
    assert.equal(tokenGated.stdout.includes("fixture-started"), false);

    const explicitUnauthenticated = await runStandalone(createStandaloneFixture(), {
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtime.url,
      LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
    });
    assert.equal(explicitUnauthenticated.status, 0);
    assert.match(explicitUnauthenticated.stdout, /fixture-started/);
    assert.equal(explicitUnauthenticated.stdout.includes("runtime-started"), false);
  } finally {
    await runtime.close();
  }
});

test("token-gated standalone rejects custom non-loopback runtimes", async () => {
  const tokenGated = await runStandalone(createStandaloneFixture(), {
    LOCAL_STUDIO_AGENT_RUNTIME_URL: "http://runtime.invalid:8081",
    LOCAL_STUDIO_FRONTEND_TOKEN: "secret",
  });
  assert.equal(tokenGated.status, 1);
  assert.match(tokenGated.stderr, /frontend-owned loopback agent runtime/);

  const explicitUnauthenticated = await runStandalone(createStandaloneFixture(), {
    LOCAL_STUDIO_AGENT_RUNTIME_URL: "http://runtime.invalid:8081",
    LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
  });
  assert.equal(explicitUnauthenticated.status, 1);
  assert.match(explicitUnauthenticated.stderr, /Agent runtime is unavailable/);
});

test("standalone runtime URL validation never echoes rejected input", async () => {
  const marker = "standalone-runtime-secret-marker";
  const invalidValues = [
    `not-a-url-${marker}`,
    `ftp://${marker}.example`,
    `http://operator:${marker}@127.0.0.1:8081`,
    `http://127.0.0.1:8081/?token=${marker}`,
    `http://127.0.0.1:8081/#${marker}`,
    `http://127.0.0.1:8081/${marker}`,
  ];
  for (const runtimeUrl of invalidValues) {
    const result = await runStandalone(createStandaloneFixture(), {
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtimeUrl,
      LOCAL_STUDIO_FRONTEND_TOKEN: "secret",
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1);
    assert.equal(output.includes(marker), false);
    assert.match(output, /Agent runtime URL configuration is invalid/);
  }
});

test("remote deployment commands migrate runtime ownership to the frontend", () => {
  const { log, root } = createDeployFixture();
  for (const command of ["frontend", "agent-runtime", "all"]) {
    const deployment = runDeployFixture(root, log, command);
    assert.match(deployment, /services\/agent-runtime\/dist\/standalone\.mjs/);
    assert.match(deployment, /frontend\/desktop\/resources/);
    assert.match(deployment, /legacy_runtime_service=local-studio-agent-runtime\.service/);
    assert.match(deployment, /systemctl --user disable --now "\$legacy_runtime_service"/);
    assert.match(deployment, /rm -f "\$unit_file"/);
    assert.match(deployment, /rm -f "\$remote_dir\/scripts\/systemd\/\$legacy_runtime_service"/);
    assert.match(deployment, /nohup node scripts\/start-standalone\.mjs/);
    assert.doesNotMatch(deployment, /systemctl --user restart local-studio-agent-runtime\.service/);
    if (command === "agent-runtime") {
      const buildIndex = deployment.indexOf("npm run build");
      const nextArtifactIndex = deployment.indexOf("frontend/.next/");
      const restartIndex = deployment.indexOf(
        "legacy_runtime_service=local-studio-agent-runtime.service",
      );
      assert(buildIndex >= 0);
      assert(nextArtifactIndex > buildIndex);
      assert(restartIndex > nextArtifactIndex);
    }
  }
});

test("frontend-only deployment synchronizes standalone runtime imports", () => {
  const { log, remote, root } = createDeployFixture();
  const sharedEnvironment = join(remote, "shared/agent/frontend-environment.mjs");
  assert.equal(existsSync(sharedEnvironment), false);
  runDeployFixture(root, log, "frontend");
  assert.equal(existsSync(sharedEnvironment), true);
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of accessVariables) delete environment[name];
  const productionNodeEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    NODE_ENV: "production",
  };
  const startup = spawnSync(
    process.env.npm_node_execpath ?? "node",
    ["scripts/start-standalone.mjs"],
    {
      cwd: join(remote, "frontend"),
      encoding: "utf8",
      env: productionNodeEnvironment,
    },
  );
  const output = `${startup.stdout}${startup.stderr}`;
  assert.equal(startup.status, 1);
  assert.match(output, /Production frontend access requires/);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/);
});

test("standalone startup accepts token, override, desktop, and local env file", async () => {
  const token = await runStandalone(createStandaloneFixture(), {
    LOCAL_STUDIO_FRONTEND_TOKEN: "secret",
  });
  assert.equal(token.status, 0);
  assert.match(token.stdout, /runtime-started/);
  assert.match(token.stdout, /fixture-started/);
  assert.match(token.stdout, /"runtimeOperator":false/);
  assert.match(token.stdout, /"descendantOperator":false/);
  assert.equal(token.stdout.includes("secret"), false);

  const override = await runStandalone(createStandaloneFixture(), {
    LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "true",
  });
  assert.equal(override.status, 0);

  const desktop = await runStandalone(createStandaloneFixture(), {
    LOCAL_STUDIO_DESKTOP: "1",
    HOSTNAME: "127.0.0.1",
  });
  assert.equal(desktop.status, 0);

  const fileFixture = createStandaloneFixture();
  writeFileSync(join(fileFixture, ".env.local"), "LOCAL_STUDIO_FRONTEND_TOKEN=file-secret\n");
  const envFile = await runStandalone(fileFixture);
  assert.equal(envFile.status, 0);

  const precedenceFixture = createStandaloneFixture();
  writeFileSync(
    join(precedenceFixture, ".env.local"),
    "LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED=true\n",
  );
  const precedence = await runStandalone(precedenceFixture, {
    LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED: "false",
  });
  assert.equal(precedence.status, 1);
  assert.match(precedence.stderr, /Production frontend access requires/);
});
