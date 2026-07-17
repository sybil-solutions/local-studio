import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "../../app-context";
import { createApp } from "../../http/app";

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

describe("recipe routes", () => {
  test("reject misleading booleans without persistence and round-trip false", async () => {
    const app = createApp(createAppContext());
    const fields = ["trust_remote_code", "enable_auto_tool_choice"] as const;
    const invalidValues: ReadonlyArray<unknown> = [null, "true", "false", 0, 1, [], {}];

    for (const field of fields) {
      for (const [index, value] of invalidValues.entries()) {
        const id = `invalid-${field}-${index}`;
        const response = await app.request("/recipes", {
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
        expect(await response.json()).toEqual({ detail: `Error: Invalid ${field}` });

        const persisted = await app.request(`/recipes/${id}`);
        expect(persisted.status).toBe(404);
      }
    }

    const createResponse = await app.request("/recipes", {
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
    const getResponse = await app.request("/recipes/explicit-false-recipe");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({
      trust_remote_code: false,
      enable_auto_tool_choice: false,
    });
  });
});
