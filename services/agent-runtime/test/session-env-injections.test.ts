import { describe, expect, test } from "bun:test";
import { buildAgentSessionOptionsSync } from "../src/pi-runtime-helpers";

// The automations extension creates a scheduled run from inside a chat, and the
// tool's cwd argument is optional ("defaults to the current project"). Nothing
// used to carry the session's project down to the extension process, so an
// automation scheduled from a chat stored cwd:"" and the scheduler later ran it
// in whatever resolveDefaultAgentCwd() picked — the first registered project,
// not the one the chat was in. The session cwd now rides along in the env the
// same way the session model does.
describe("buildAgentSessionOptionsSync env injections", () => {
  const env = { LOCAL_STUDIO_FRONTEND_BASE: "http://127.0.0.1:3000" } as NodeJS.ProcessEnv;

  test("exports the resolved session cwd", () => {
    const options = buildAgentSessionOptionsSync({
      options: {},
      cwd: "/Users/someone/projects/widgets",
      processEnv: env,
    });
    expect(options.envInjections.LOCAL_STUDIO_CWD).toBe("/Users/someone/projects/widgets");
  });

  test("falls back to an empty value when no cwd is known", () => {
    const options = buildAgentSessionOptionsSync({ options: {}, processEnv: env });
    expect(options.envInjections.LOCAL_STUDIO_CWD).toBe("");
  });
});
