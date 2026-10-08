import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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
const gpuStatePath = join(root, "gpu.json");
const gpuState = { used: 1483, driver: "WDDM", compute: true };
const setGpu = (patch) => writeFileSync(gpuStatePath, JSON.stringify(Object.assign(gpuState, patch)));
const fixtureEnv = {};
if (process.platform === "win32") {
  const bin = join(root, "bin");
  mkdirSync(bin);
  setGpu({});
  writeFileSync(join(bin, "nvidia.cjs"), `const s = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(gpuStatePath)}, 'utf8')); console.log(process.argv.some(a => a.startsWith('--query-gpu=')) ? '0, GPU-fixture, NVIDIA GeForce RTX 3090, ' + s.used + ', 24576, ' + s.driver : s.compute ? 'GPU-fixture, 42' : '');`);
  writeFileSync(join(bin, "nvidia-smi.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0nvidia.cjs" %*\r\n`);
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  fixtureEnv[pathKey] = `${bin};${process.env[pathKey] ?? ""}`;
}
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
    ...(body === undefined ? {} : { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
const snapshot = async (port) => (await call(port, "/api/snapshot")).json();

try {
  mkdirSync(join(root, "dist"));
  const captured = { model: "preserved", card: "unknown", engine: "vllm", weights: "baked-into-image", launch: { kind: "host", port: 8000, ctx: 4096 }, proof: [{ captured: true }] };
  writeFileSync(join(root, "dist/catalog.json"), JSON.stringify({ cards: {}, recipes: { captured } }));
  git("init", "-q");
  git("add", "dist/catalog.json");
  git("-c", "user.name=Local E2E", "-c", "user.email=e2e@localhost", "commit", "-qm", "fixture");
  const commit = git("rev-parse", "HEAD").toString().trim();
  const stream = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\\"x\\\":1}"}}]}}]}\n\ndata: [DONE]\n\n';
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
        if (body.fixtureResponse) {
          res.writeHead(200, { "content-type": body.stream ? "text/event-stream" : "application/json" });
          const bytes = Buffer.from(body.fixtureResponse);
          for (let offset = 0; offset < bytes.length; offset += 7) res.write(bytes.subarray(offset, offset + 7));
          return res.end();
        }
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
    ports.push(await listen(s));
    await new Promise((resolve) => s.close(resolve));
  }
  for (const [i, port] of ports.entries()) {
    const home = join(root, `controller-${i}`);
    mkdirSync(home);
    writeFileSync(join(home, "usage.json"), JSON.stringify({ legacy: { requests: 7, lastAt: "2025-01-01T00:00:00Z" } }));
    const excludePorts = [...ports, ...(i === 0 ? [engineB] : i === 1 ? [engineA] : [engineA, engineB])];
    const peers = [`http://127.0.0.1:${ports[(i + 1) % ports.length]}`];
    const config = { id: `fixture-${i}`, name: `Fixture ${i}`, url: `http://127.0.0.1:${port}`, fleetKey: key, peers, excludePorts };
    const registry = { url: root, dir: root, ref: commit };
    writeFileSync(join(home, "config.json"), JSON.stringify({ ...config, engineKeys: { [engineA]: "fixture-engine-secret" }, registry, modelsDir: join(home, "models") }), { mode: 0o600 });
    const env = { ...process.env, ...fixtureEnv, LOCAL_STUDIO_T3_HOME: home, LOCAL_STUDIO_T3_PORT: String(port), LOCAL_STUDIO_T3_HOST: "127.0.0.1" };
    const child = spawn("bun", ["apps/local-controller/src/main.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => (log += chunk));
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
    return ["alpha", "beta"].every((id) => s.models.some((m) => m.id === id && m.live)) && s.controllers.length === 3;
  }, "discovery and cyclic controller graph");
  const s = await snapshot(a);
  assert.equal(s.controllers.filter((x) => x.reachable).length, 3);
  assert.equal(s.endpoints.filter((x) => x.models.includes("shared")).length, 2);
  if (process.platform === "win32") {
    const gpu = async (port) => (await snapshot(port)).hardware.gpus[0];
    await waitFor(async () => (await gpu(c))?.busy === false, "WDDM desktop processes do not reserve GPU");
    assert.equal((await gpu(a)).busy, true, "a local inference endpoint protects a WDDM GPU even below 2 GiB");
    setGpu({ used: 4096 });
    await waitFor(async () => (await gpu(c))?.busy === true, "WDDM memory guard");
    setGpu({ used: 1483, driver: "TCC" });
    await waitFor(async () => {
      const g = await gpu(c);
      return g?.memoryUsedMiB === 1483 && g.busy;
    }, "TCC compute processes still reserve GPU");
    setGpu({ compute: false });
    await waitFor(async () => (await gpu(c))?.busy === false, "idle TCC GPU is available");
    setGpu({ driver: "WDDM", compute: true });
    console.log("PASS Windows GPU E2E: WDDM desktop activity, live inference guard, memory guard, TCC compute and idle states.");
  }
  assert.equal((await call(a, "/api/recipes/captured/run", {})).status, 409);
  assert.equal((await call(a, "/api/peers", "{")).status, 400);
  assert.equal((await call(a, "/api/peers", { url: `http://127.0.0.1:${a}` })).status, 400);
  assert.equal((await call(a, "/v1/completions", { model: "not-live" })).status, 404);
  const raw = '{ "model": "alpha", "stream": true, "messages": [{"role":"user","content":"native"}], "extra_body": {"nested":[1,2,3]} }';
  const streamed = await call(a, "/v1/chat/completions", raw, { ...auth, "x-api-key": "client-secret", cookie: "private=value", "anthropic-version": "2023-06-01" });
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
  await waitFor(async () => (await snapshot(a)).auto === "beta", "auto follows most-used live model");
  const auto = await call(a, "/v1/responses", { model: "auto", input: "route" });
  assert.equal((await auto.json()).model, "beta");
  await waitFor(async () => (await snapshot(a)).models.find((m) => m.id === "beta")?.requests === 4, "usage counts once across graph");
  assert.equal((await snapshot(b)).usage.find((u) => u.model === "beta").requests, 4);
  const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const cases = [
    ["completions", false, JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }), 16],
    ["chat/completions", true, event({ choices: [{ delta: { content: "π" } }], usage: null }) + event({ usage: { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 } }) + "data: [DONE]\r\n\r\n", 20],
    ["responses", true, event({ type: "response.completed", response: { usage: { input_tokens: 19, output_tokens: 7, total_tokens: 26 } } }), 26],
    ["messages", false, JSON.stringify({ usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 31, cache_creation_input_tokens: 7 } }), 43],
    ["messages", true, event({ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 37, cache_creation_input_tokens: 11 } } }) + event({ type: "message_delta", usage: { output_tokens: 3 } }) + event({ type: "message_delta", usage: { output_tokens: 13, cache_read_input_tokens: 37 } }) + event({ type: "message_stop" }), 66],
    ["responses", false, JSON.stringify({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }), 0],
    ["chat/completions", true, event({ usage: { prompt_tokens: 3, completion_tokens: 4 } }), null],
    ["messages", true, event({ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } }) + event({ type: "error", error: { type: "overloaded_error" } }) + event({ type: "message_stop" }), null],
  ];
  for (const [path, stream, fixtureResponse, expected] of cases) {
    const before = (await (await call(b, "/api/node")).json()).usage.find((u) => u.model === "beta");
    const response = await call(c, `/v1/${path}`, { model: "beta", stream, fixtureResponse });
    assert.equal(await response.text(), fixtureResponse);
    const after = (await (await call(b, "/api/node")).json()).usage.find((u) => u.model === "beta");
    const sum = (row) => Object.values(row.tokens ?? {}).reduce((a, b) => a + b, 0);
    assert.equal(sum(after) - sum(before), expected ?? 0, path);
    assert.equal(after.measuredRequests - (before.measuredRequests ?? 0), Number(expected !== null), path);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "controller-1/usage.json"))).beta.tokens, after.tokens);
  }
  await waitFor(async () => (await snapshot(a)).usage.find((u) => u.model === "beta")?.measuredRequests === 6, "federated measured usage");
  const tracked = (await snapshot(a)).usage;
  assert.equal(Object.values(tracked.find((u) => u.model === "beta").tokens).reduce((a, b) => a + b, 0), 171);
  assert.equal(tracked.find((u) => u.model === "legacy").requests, 21);
  assert.equal(tracked.find((u) => u.model === "legacy").measuredRequests, 0);
  await new Promise((resolve) => servers.find((server) => server.address()?.port === engineB).close(resolve));
  await waitFor(async () => (await snapshot(a)).auto === "alpha", "auto excludes offline most-used model");
  const models = await (await call(a, "/v1/models")).json();
  assert(models.data.some((m) => m.id === "auto"));
  assert(!models.data.some((m) => m.id === "beta"));
  console.log("PASS E2E: authentication, discovery, multi-API models, cyclic federation, native streams/errors, credential isolation, registry launch guard, auto and usage.");
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map((child) => (child.exitCode === null ? once(child, "exit") : undefined)));
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  rmSync(root, { recursive: true, force: true });
}
