import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineJob } from "@local-studio/contracts/system";
import { Effect, Schedule } from "effect";
import type { ControllerRuntime } from "../src/core/effect-runtime";
import type { createApp } from "../src/http/app";

const BASE_ENV_KEYS = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_MOCK_INFERENCE",
  "LOCAL_STUDIO_MOCK_MODEL_ID",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "PI_CODING_AGENT_DIR",
] as const;

type EnvironmentSnapshot = Record<(typeof BASE_ENV_KEYS)[number], string | undefined>;

let environmentSnapshot: EnvironmentSnapshot;
let temporaryDirectory: string;
let controllerRuntime: ControllerRuntime;

beforeEach(() => {
  environmentSnapshot = Object.fromEntries(
    BASE_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as EnvironmentSnapshot;
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-runtime-boundary-"));
  Object.assign(process.env, {
    LOCAL_STUDIO_DATA_DIR: temporaryDirectory,
    LOCAL_STUDIO_DB_PATH: join(temporaryDirectory, "controller.db"),
    LOCAL_STUDIO_MODELS_DIR: join(temporaryDirectory, "models"),
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: "18080",
    LOCAL_STUDIO_INFERENCE_PORT: "65534",
    LOCAL_STUDIO_MOCK_INFERENCE: "true",
    LOCAL_STUDIO_MOCK_MODEL_ID: "mock-model",
    LOCAL_STUDIO_RUNTIME_SKIP_DOCKER: "1",
    LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
    PI_CODING_AGENT_DIR: join(temporaryDirectory, "pi-agent"),
  });
  delete process.env["LOCAL_STUDIO_API_KEY"];
});

afterEach(async () => {
  await controllerRuntime?.dispose();
  for (const key of BASE_ENV_KEYS) {
    const value = environmentSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Effect.runPromise(Effect.sleep(50));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

const createTestApp = async (): Promise<ReturnType<typeof createApp>> => {
  const [{ AppContextService }, { createControllerRuntime }, { createApp }] = await Promise.all([
    import("../src/app-context"),
    import("../src/core/effect-runtime"),
    import("../src/http/app"),
  ]);
  controllerRuntime = createControllerRuntime();
  const context = await controllerRuntime.runPromise(AppContextService);
  return createApp(context, controllerRuntime);
};

const DISPATCH_ENV_KEYS = [
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

const terminalStatuses = new Set<EngineJob["status"]>([
  "success",
  "error",
  "cancelled",
]);
const terminalJobSchedule = Schedule.spaced(20).pipe(Schedule.both(Schedule.recurs(250)));

let dispatchEnvironmentSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  dispatchEnvironmentSnapshot = Object.fromEntries(
    DISPATCH_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of DISPATCH_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of DISPATCH_ENV_KEYS) {
    const value = dispatchEnvironmentSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const writeMarkerCommand = (name: string): { command: string; marker: string } => {
  const command = join(temporaryDirectory, `${name}.sh`);
  const marker = `${command}.invoked`;
  writeFileSync(command, '#!/usr/bin/env sh\nprintf invoked > "$0.invoked"\n', "utf8");
  chmodSync(command, 0o755);
  return { command, marker };
};

const awaitTerminalJob = (
  app: Awaited<ReturnType<typeof createTestApp>>,
  id: string,
): Promise<EngineJob> =>
  Effect.runPromise(
    Effect.tryPromise(async () => {
      const response = await app.request(`/runtime/jobs/${id}`);
      if (!response.ok) throw new Error(`Runtime job ${id} was not found`);
      const body = await response.json();
      return body.job;
    }).pipe(
      Effect.flatMap((job) =>
        job && terminalStatuses.has(job.status)
          ? Effect.succeed(job)
          : Effect.fail(new Error(`Runtime job ${id} did not reach a terminal state`)),
      ),
      Effect.retry(terminalJobSchedule),
    ),
  );

describe("runtime job command boundary", () => {
  describe("POST /runtime/jobs", () => {
    const unsupportedTypes = ["inspect", "download"] as const;
    const backends = ["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const;

    for (const type of unsupportedTypes) {
      for (const backend of backends) {
        test(`rejects ${type} for ${backend} without queueing a job`, async () => {
          const app = await createTestApp();
          const before = await app.request("/runtime/jobs");
          const beforeBody = await before.json();
          const response = await app.request("/runtime/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ backend, type }),
          });
          const after = await app.request("/runtime/jobs");

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ detail: "Invalid payload" });
          expect(await after.json()).toEqual(beforeBody);
        });
      }
    }

    test("rejects a request-controlled command field with 400", async () => {
      const app = await createTestApp();
      const response = await app.request("/runtime/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "llamacpp", type: "update", command: "whoami" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ detail: "Invalid payload" });
    });

    test("rejects a request-controlled args field with 400", async () => {
      const app = await createTestApp();
      const response = await app.request("/runtime/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "llamacpp", type: "update", args: ["-c", "whoami"] }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ detail: "Invalid payload" });
    });

    for (const type of ["install", "update"] as const) {
      test(`dispatches llama.cpp ${type} to the engine handler`, async () => {
        const engine = writeMarkerCommand(`llamacpp-${type}`);
        const platform = writeMarkerCommand(`cuda-decoy-${type}`);
        process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;
        process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;
        const app = await createTestApp();

        const response = await app.request("/runtime/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend: "llamacpp", type }),
        });
        const body = await response.json();
        const job = await awaitTerminalJob(app, body.job.id);

        expect(response.status).toBe(200);
        expect(job).toMatchObject({
          backend: "llamacpp",
          type,
          status: "success",
          command: engine.command,
        });
        expect(existsSync(engine.marker)).toBe(true);
        expect(existsSync(platform.marker)).toBe(false);
      });
    }

    for (const { backend, envKey } of [
      { backend: "cuda", envKey: "LOCAL_STUDIO_CUDA_UPGRADE_CMD" },
      { backend: "rocm", envKey: "LOCAL_STUDIO_ROCM_UPGRADE_CMD" },
    ] as const) {
      test(`terminates ${backend} install without invoking the platform handler`, async () => {
        const platform = writeMarkerCommand(`${backend}-install`);
        process.env[envKey] = platform.command;
        const app = await createTestApp();

        const response = await app.request("/runtime/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend, type: "install" }),
        });
        const body = await response.json();
        const job = await awaitTerminalJob(app, body.job.id);

        expect(response.status).toBe(200);
        expect(job).toMatchObject({
          type: "install",
          status: "error",
          error: `${backend.toUpperCase()} supports update jobs only.`,
        });
        expect(existsSync(platform.marker)).toBe(false);
      });

      test(`dispatches ${backend} update to the platform handler`, async () => {
        const platform = writeMarkerCommand(`${backend}-update`);
        process.env[envKey] = platform.command;
        const app = await createTestApp();

        const response = await app.request("/runtime/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend, type: "update" }),
        });
        const body = await response.json();
        const job = await awaitTerminalJob(app, body.job.id);

        expect(response.status).toBe(200);
        expect(job).toMatchObject({
          type: "update",
          status: "success",
          command: platform.command,
        });
        expect(existsSync(platform.marker)).toBe(true);
      });
    }

    test("defaults an omitted type to the update handler", async () => {
      const platform = writeMarkerCommand("cuda-default-update");
      process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;
      const app = await createTestApp();

      const response = await app.request("/runtime/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "cuda" }),
      });
      const body = await response.json();
      const job = await awaitTerminalJob(app, body.job.id);

      expect(response.status).toBe(200);
      expect(job).toMatchObject({
        type: "update",
        status: "success",
        command: platform.command,
      });
      expect(existsSync(platform.marker)).toBe(true);
    });

  });

  const upgradeRoutes = [
    "/runtime/vllm/upgrade",
    "/runtime/sglang/upgrade",
    "/runtime/llamacpp/upgrade",
    "/runtime/cuda/upgrade",
    "/runtime/rocm/upgrade",
  ] as const;

  for (const path of upgradeRoutes) {
    describe(`POST ${path}`, () => {
      test("rejects a request-controlled command field with 400", async () => {
        const app = await createTestApp();
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: "whoami" }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ detail: "Invalid payload" });
      });

      test("rejects a request-controlled args field with 400", async () => {
        const app = await createTestApp();
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ args: ["-c", "whoami"] }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ detail: "Invalid payload" });
      });
    });
  }
});
