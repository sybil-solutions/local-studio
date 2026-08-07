import assert from "node:assert/strict";
import { test } from "bun:test";
import { Effect } from "effect";
import { BROWSER_SESSION_HEADER } from "../../../shared/agent/browser-session";
import { browserSessionConfig } from "../src/browser-host/browser-session";
import { buildAgentSessionOptionsSync, withRuntimeEnvInjections } from "../src/pi-runtime-helpers";

test("browser session configuration defaults and accepts exact boundaries", () => {
  assert.deepEqual(browserSessionConfig({}), { idleMs: 900_000, maxSessions: 8 });
  assert.deepEqual(
    browserSessionConfig({
      LOCAL_STUDIO_BROWSER_MAX_SESSIONS: "1",
      LOCAL_STUDIO_BROWSER_SESSION_IDLE_MS: "60000",
    }),
    { idleMs: 60_000, maxSessions: 1 },
  );
  assert.deepEqual(
    browserSessionConfig({
      LOCAL_STUDIO_BROWSER_MAX_SESSIONS: "32",
      LOCAL_STUDIO_BROWSER_SESSION_IDLE_MS: "86400000",
    }),
    { idleMs: 86_400_000, maxSessions: 32 },
  );
});

test("browser session configuration rejects invalid explicit values", () => {
  for (const maxSessions of ["", "0", "33", "1.5", "eight", "Infinity"]) {
    assert.throws(() => browserSessionConfig({ LOCAL_STUDIO_BROWSER_MAX_SESSIONS: maxSessions }));
  }
  for (const idleMs of ["", "59999", "86400001", "60000.5", "idle", "Infinity"]) {
    assert.throws(() => browserSessionConfig({ LOCAL_STUDIO_BROWSER_SESSION_IDLE_MS: idleMs }));
  }
});

test("runtime options inject the canonical focused browser session", () => {
  const result = buildAgentSessionOptionsSync({
    options: { browserSessionId: "session-a", browserToolEnabled: true },
    processEnv: { LOCAL_STUDIO_FRONTEND_BASE: "http://127.0.0.1:3000" },
  });
  assert.equal(result.envInjections.LOCAL_STUDIO_BROWSER_SESSION_HEADER, BROWSER_SESSION_HEADER);
  assert.equal(result.envInjections.LOCAL_STUDIO_BROWSER_SESSION_ID, "session-a");
  assert.equal(result.envInjections.SITEGEIST_RELAY_SESSION_ID, "session-a");
  assert.throws(() =>
    buildAgentSessionOptionsSync({
      options: { browserSessionId: "bad key", browserToolEnabled: true },
      processEnv: {},
    }),
  );
  assert.throws(() =>
    buildAgentSessionOptionsSync({ options: { browserToolEnabled: true }, processEnv: {} }),
  );
});

test("runtime environment injection is serialized and restored exactly", async () => {
  const env: NodeJS.ProcessEnv = { LOCAL_STUDIO_BROWSER_SESSION_ID: "original" };
  const observed: string[] = [];
  const run = (sessionId: string) =>
    Effect.runPromise(
      withRuntimeEnvInjections(
        { LOCAL_STUDIO_BROWSER_SESSION_ID: sessionId, TEMPORARY_BROWSER_KEY: sessionId },
        Effect.gen(function* () {
          observed.push(`${sessionId}:${env.LOCAL_STUDIO_BROWSER_SESSION_ID}`);
          yield* Effect.sleep(5);
          observed.push(`${sessionId}:${env.LOCAL_STUDIO_BROWSER_SESSION_ID}`);
        }),
        env,
      ),
    );
  await Promise.all([run("session-a"), run("session-b")]);
  assert.deepEqual(observed, [
    "session-a:session-a",
    "session-a:session-a",
    "session-b:session-b",
    "session-b:session-b",
  ]);
  assert.equal(env.LOCAL_STUDIO_BROWSER_SESSION_ID, "original");
  assert.equal(Object.hasOwn(env, "TEMPORARY_BROWSER_KEY"), false);
});
