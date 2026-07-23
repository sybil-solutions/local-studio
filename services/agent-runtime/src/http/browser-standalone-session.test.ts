import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { promisify } from "node:util";
import test from "node:test";
import { BROWSER_SESSION_HEADER } from "../browser-session-contract";

const execFileAsync = promisify(execFile);
const INVALID_SESSION = {
  error: `A valid ${BROWSER_SESSION_HEADER} header is required`,
  ok: false,
};
const STATEFUL_REQUESTS: ReadonlyArray<{
  body?: string;
  method: "GET" | "POST";
  path: string;
}> = [
  { body: "{}", method: "POST", path: "/api/agent/browser/get-url" },
  { body: "not-json", method: "POST", path: "/api/agent/browser/get-url" },
  { method: "GET", path: "/api/agent/browser/frame" },
  { body: "not-json", method: "POST", path: "/api/agent/browser/input" },
  { method: "GET", path: "/api/agent/browser/state" },
  { body: "not-json", method: "POST", path: "/api/agent/browser/viewport" },
];

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Temporary loopback server has no numeric port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function bundleStandalone(): Promise<void> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(command, ["run", "bundle", "--silent"], { cwd: process.cwd() });
}

async function startStandalone(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["dist/standalone.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = Promise.withResolvers<void>();
  let output = "";
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes("[agent-runtime] listening")) ready.resolve();
  };
  const onError = (error: Error) => ready.reject(error);
  const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
    ready.reject(new Error(`Standalone exited before ready: ${code ?? signal ?? "unknown"}`));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", onError);
  child.once("exit", onExit);
  const timer = setTimeout(
    () => ready.reject(new Error(`Standalone start timed out: ${output}`)),
    10_000,
  );
  try {
    await ready.promise;
    return child;
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  } finally {
    clearTimeout(timer);
    child.stdout?.off("data", onData);
    child.stderr?.off("data", onData);
    child.off("error", onError);
    child.off("exit", onExit);
  }
}

async function stopStandalone(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

function sessionHeaders(session: string | undefined): HeadersInit {
  return session === undefined ? {} : { [BROWSER_SESSION_HEADER]: session };
}

test("standalone browser routes reject invalid session keys before request parsing", async (context) => {
  await bundleStandalone();
  const port = await availablePort();
  const child = await startStandalone(port);
  context.after(() => stopStandalone(child));
  const origin = `http://127.0.0.1:${port}`;
  for (const session of [undefined, "", "bad key"]) {
    for (const request of STATEFUL_REQUESTS) {
      const response = await fetch(`${origin}${request.path}`, {
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: sessionHeaders(session),
        method: request.method,
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), INVALID_SESSION);
    }
  }
  const valid = await fetch(`${origin}/api/agent/browser/get-url`, {
    body: "not-json",
    headers: sessionHeaders("session-a"),
    method: "POST",
  });
  assert.equal(valid.status, 400);
  assert.deepEqual(await valid.json(), { error: "Invalid browser command JSON", ok: false });
  const statelessFetch = await fetch(`${origin}/api/agent/browser/fetch`, {
    headers: sessionHeaders("bad key"),
  });
  assert.equal(statelessFetch.status, 400);
  assert.deepEqual(await statelessFetch.json(), { error: "url is required" });
  const statelessLocalhosts = await fetch(`${origin}/api/agent/browser/localhosts`, {
    headers: sessionHeaders("bad key"),
  });
  assert.equal(statelessLocalhosts.status, 200);
});
