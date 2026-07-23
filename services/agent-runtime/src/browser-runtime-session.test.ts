import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { BROWSER_SESSION_HEADER } from "./browser-session-contract";
import { buildAgentSessionOptionsSync, withRuntimeEnvInjections } from "./pi-runtime-helpers";

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
