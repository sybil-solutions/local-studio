import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

const dataDir = mkdtempSync(path.join(tmpdir(), "google-built-in-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
process.env.LOCAL_STUDIO_GOOGLE_CLIENT_ID = "built-in.apps.googleusercontent.com";
process.env.LOCAL_STUDIO_GOOGLE_CLIENT_SECRET = "built-in-secret";

const { getGoogleAccount, resolveGoogleAccountFilePath, saveGoogleClient } = await import(
  "../src/google-account"
);

afterAll(() => {
  delete process.env.LOCAL_STUDIO_GOOGLE_CLIENT_ID;
  delete process.env.LOCAL_STUDIO_GOOGLE_CLIENT_SECRET;
  rmSync(dataDir, { recursive: true, force: true });
});

function fakeVault(store: Map<string, string>) {
  return {
    read: (key: string) => Effect.succeed(store.get(key)),
    write: (key: string, value: string) => Effect.sync(() => void store.set(key, value)),
    remove: (key: string) => Effect.sync(() => void store.delete(key)),
  };
}

describe("local studio's built-in google client", () => {
  test("a fresh install is configured with the built-in client and its secret", async () => {
    const view = await Effect.runPromise(getGoogleAccount());
    expect(view.configured).toBe(true);
    expect(view.clientId).toBe("built-in.apps.googleusercontent.com");
    expect(view.hasClientSecret).toBe(true);
    expect(view.builtInClient).toBe(true);
  });

  test("an install that saved the built-in id without a secret gets the secret supplied", async () => {
    writeFileSync(
      resolveGoogleAccountFilePath(),
      JSON.stringify({
        version: 2,
        clientId: "built-in.apps.googleusercontent.com",
        hasClientSecret: false,
        accounts: {},
      }),
    );
    const view = await Effect.runPromise(
      saveGoogleClient({ clientId: "built-in.apps.googleusercontent.com" }, fakeVault(new Map())),
    );
    expect(view.hasClientSecret).toBe(true);
    expect(view.builtInClient).toBe(true);
  });

  test("a user's own client still needs its own secret", async () => {
    const saved = Effect.runPromise(
      saveGoogleClient({ clientId: "mine.apps.googleusercontent.com" }, fakeVault(new Map())),
    );
    await expect(saved).rejects.toThrow("Client secret is required");
  });
});
