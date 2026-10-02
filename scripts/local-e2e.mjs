import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "local-studio-e2e-"));
const key = randomBytes(24).toString("hex");
const children = [];
const servers = [];
const received = [];
const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", timeout: 10_000 });
const listen = async (server) => {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const waitFor = async (fn, label, ms = 35_000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${label}`, { cause: last });
};
const call = (port, path, body, headers = auth) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    headers,
    ...(body === undefined
      ? {}
      : { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
const snapshot = async (port) => (await call(port, "/api/snapshot")).json();

try {
  mkdirSync(join(root, "dist"));
  writeFileSync(
    join(root, "dist/catalog.json"),
    JSON.stringify({
      cards: {},
      recipes: {
        captured: {
          model: "preserved",
          card: "unknown",
          engine: "vllm",
          weights: "baked-into-image",
          launch: { kind: "host", port: 8000, ctx: 4096 },
          proof: [{ captured: true }],
        },
      },
    }),
  );
  git("init", "-q");
  git("add", "dist/catalog.json");
  git("-c", "user.name=Local E2E", "-c", "user.email=e2e@localhost", "commit", "-qm", "fixture");
  const commit = git("rev-parse", "HEAD").toString().trim();
  const stream =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\\"x\\\":1}"}}]}}]}\n\ndata: [DONE]\n\n';
  const engine = async (models) =>
    listen(
      createServer(async (req, res) => {
        if (req.url === "/v1/models") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        received.push({ raw, headers: req.headers, path: req.url });
        const body = JSON.parse(raw);
        if (req.url === "/v1/messages") {
          res.writeHead(422, { "content-type": "application/json", "x-engine-error": "native" });
          return res.end('{"error":{"type":"native_fixture_error"}}');
        }
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "x-engine-stream": "native" });
          res.write(stream.slice(0, 21));
          return setTimeout(() => res.end(stream.slice(21)), 15);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ model: body.model, fixture: true, path: req.url }));
      }),
    );
  const engineA = await engine(["alpha", "shared"]);
  const engineB = await engine(["beta", "shared"]);
  const ports = [];
  for (let i = 0; i < 3; i++) {
    const s = createServer();
    const p = await listen(s);
    await new Promise((resolve) => s.close(resolve));
    ports.push(p);
  }
  for (const [i, port] of ports.entries()) {
    const home = join(root, `controller-${i}`);
    mkdirSync(home);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        id: `fixture-${i}`,
        name: `Fixture ${i}`,
        url: `http://127.0.0.1:${port}`,
        fleetKey: key,
        peers: [`http://127.0.0.1:${ports[(i + 1) % ports.length]}`],
        excludePorts: [
          ...ports,
          ...(i === 0 ? [engineB] : i === 1 ? [engineA] : [engineA, engineB]),
        ],
        engineKeys: { [engineA]: "fixture-engine-secret" },
        registry: { url: root, dir: root, ref: commit },
        modelsDir: join(home, "models"),
      }),
      { mode: 0o600 },
    );
    const child = spawn("bun", ["apps/local-controller/src/main.ts"], {
      env: {
        ...process.env,
        LOCAL_STUDIO_T3_HOME: home,
        LOCAL_STUDIO_T3_PORT: String(port),
        LOCAL_STUDIO_T3_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    children.push(child);
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(log);
      return (await call(port, "/api/health", undefined, {})).ok;
    }, `controller ${i} health`);
  }
  const [a, b, c] = ports;
  assert.equal((await call(a, "/api/snapshot", undefined, {})).status, 401);
  await waitFor(async () => {
    const s = await snapshot(a);
    return (
      s.models.some((m) => m.id === "alpha" && m.live) &&
      s.models.some((m) => m.id === "beta" && m.live) &&
      s.controllers.length === 3
    );
  }, "discovery and cyclic controller graph");
  const s = await snapshot(a);
  assert.equal(s.controllers.filter((x) => x.reachable).length, 3);
  assert.equal(s.endpoints.filter((x) => x.models.includes("shared")).length, 2);
  assert.equal((await call(a, "/api/recipes/captured/run", {})).status, 409);
  assert.equal((await call(a, "/api/peers", "{")).status, 400);
  assert.equal((await call(a, "/api/peers", { url: `http://127.0.0.1:${a}` })).status, 400);
  assert.equal((await call(a, "/v1/completions", { model: "not-live" })).status, 404);
  const raw =
    '{ "model": "alpha", "stream": true, "messages": [{"role":"user","content":"native"}], "extra_body": {"nested":[1,2,3]} }';
  const streamed = await call(a, "/v1/chat/completions", raw, {
    ...auth,
    "x-api-key": "client-secret",
    cookie: "private=value",
    "anthropic-version": "2023-06-01",
  });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get("x-engine-stream"), "native");
  assert.equal(await streamed.text(), stream);
  assert.equal(received.at(-1).raw, raw);
  assert.equal(received.at(-1).headers.authorization, "Bearer fixture-engine-secret");
  assert.equal(received.at(-1).headers["x-api-key"], undefined);
  assert.equal(received.at(-1).headers.cookie, undefined);
  assert.equal(received.at(-1).headers["anthropic-version"], "2023-06-01");
  const nativeError = await call(c, "/v1/messages", { model: "beta", messages: [] });
  assert.equal(nativeError.status, 422);
  assert.equal(nativeError.headers.get("x-engine-error"), "native");
  assert.equal(await nativeError.text(), '{"error":{"type":"native_fixture_error"}}');
  for (const path of ["/v1/responses", "/v1/completions", "/v1/chat/completions"]) {
    const r = await call(c, path, { model: "beta", input: "native" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { model: "beta", fixture: true, path });
  }
  await waitFor(
    async () => (await snapshot(a)).auto === "beta",
    "auto follows most-used live model",
  );
  const auto = await call(a, "/v1/responses", { model: "auto", input: "route" });
  assert.equal((await auto.json()).model, "beta");
  await waitFor(
    async () => (await snapshot(a)).models.find((m) => m.id === "beta")?.requests === 4,
    "usage counts once across graph",
  );
  assert.equal((await snapshot(b)).usage.find((u) => u.model === "beta").requests, 4);
  await new Promise((resolve) =>
    servers.find((server) => server.address()?.port === engineB).close(resolve),
  );
  await waitFor(
    async () => (await snapshot(a)).auto === "alpha",
    "auto excludes offline most-used model",
  );
  const models = await (await call(a, "/v1/models")).json();
  assert(models.data.some((m) => m.id === "auto"));
  assert(!models.data.some((m) => m.id === "beta"));
  console.log(
    "PASS E2E: authentication, discovery, multi-API models, cyclic federation, native streams/errors, credential isolation, registry launch guard, auto and usage.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) => (child.exitCode === null ? once(child, "exit") : undefined)),
  );
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  rmSync(root, { recursive: true, force: true });
}
