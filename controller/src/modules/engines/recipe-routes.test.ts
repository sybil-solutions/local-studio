import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { AppContextService } from "../../app-context";
import { createControllerRuntime, type ControllerRuntime } from "../../core/effect-runtime";
import { createApp } from "../../http/app";
import { runControllerEffect } from "../../http/effect-handler";

const environmentKeys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_MOCK_INFERENCE",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "LOCAL_STUDIO_API_KEY",
  "PI_CODING_AGENT_DIR",
] as const;

let environmentSnapshot: Map<string, string | undefined>;
let testDirectory: string;
let runtime: ControllerRuntime;

const requestEffect = (
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Effect.Effect<Response, unknown> =>
  Effect.tryPromise({ try: async () => app.request(path, init), catch: (error) => error });

beforeEach(() => {
  environmentSnapshot = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  testDirectory = mkdtempSync(join(tmpdir(), "local-studio-recipe-route-"));
  Object.assign(process.env, {
    LOCAL_STUDIO_DATA_DIR: testDirectory,
    LOCAL_STUDIO_DB_PATH: join(testDirectory, "controller.db"),
    LOCAL_STUDIO_MODELS_DIR: join(testDirectory, "models"),
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: "18080",
    LOCAL_STUDIO_INFERENCE_PORT: "65534",
    LOCAL_STUDIO_MOCK_INFERENCE: "true",
    LOCAL_STUDIO_RUNTIME_SKIP_DOCKER: "1",
    LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
    PI_CODING_AGENT_DIR: join(testDirectory, "pi-agent"),
  });
  delete process.env["LOCAL_STUDIO_API_KEY"];
  runtime = createControllerRuntime();
});

afterEach(() => {
  for (const key of environmentKeys) {
    const value = environmentSnapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(testDirectory, { recursive: true, force: true });
});

afterEach(() => runtime.dispose());

describe("recipe routes", () => {
  test("reject misleading booleans without persistence and round-trip false", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const context = yield* AppContextService;
        const app = createApp(context, runtime);
        const fields = ["trust_remote_code", "enable_auto_tool_choice"] as const;
        const invalidValues: ReadonlyArray<unknown> = [null, "true", "false", 0, 1, [], {}];

        for (const field of fields) {
          for (const [index, value] of invalidValues.entries()) {
            const id = `invalid-${field}-${index}`;
            const response = yield* requestEffect(app, "/recipes", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id,
                name: "Invalid Boolean Recipe",
                model_path: join(testDirectory, "models", id),
                [field]: value,
              }),
            });

            expect(response.status).toBe(400);
            expect(yield* Effect.promise(() => response.json())).toEqual({
              detail: `Error: Invalid ${field}`,
            });

            const persisted = yield* requestEffect(app, `/recipes/${id}`);
            expect(persisted.status).toBe(404);
          }
        }

        const createResponse = yield* requestEffect(app, "/recipes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "explicit-false-recipe",
            name: "Explicit False Recipe",
            model_path: join(testDirectory, "models", "explicit-false-recipe"),
            trust_remote_code: false,
            enable_auto_tool_choice: false,
          }),
        });

        expect(createResponse.status).toBe(200);
        const getResponse = yield* requestEffect(app, "/recipes/explicit-false-recipe");
        expect(getResponse.status).toBe(200);
        expect(yield* Effect.promise(() => getResponse.json())).toMatchObject({
          trust_remote_code: false,
          enable_auto_tool_choice: false,
        });
      }),
    ));
});
