import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineJob } from "@local-studio/contracts/system";
import { Effect, Schedule } from "effect";
import { type AppContext, AppContextService } from "../src/app-context";
import { createControllerRuntime, type ControllerRuntime } from "../src/core/effect-runtime";
import { createApp } from "../src/http/app";

const environmentKeys = [
  "HOME",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_DISABLE_METRICS",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "LOCAL_STUDIO_VLLM_UPGRADE_CMD",
  "LOCAL_STUDIO_SGLANG_UPGRADE_CMD",
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_MLX_PYTHON",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

const dispatchEnvironmentKeys = [
  "LOCAL_STUDIO_VLLM_UPGRADE_CMD",
  "LOCAL_STUDIO_SGLANG_UPGRADE_CMD",
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

const previousEnvironment = new Map<string, string | undefined>();
const terminalStatuses = new Set<EngineJob["status"]>(["success", "error", "cancelled"]);
const terminalJobSchedule = Schedule.spaced(20).pipe(Schedule.both(Schedule.recurs(250)));

let temporaryDirectory = "";
let mlxMarker = { command: "", marker: "" };
let runtime: ControllerRuntime;
let context: AppContext;
let app: ReturnType<typeof createApp>;

const writeMarkerCommand = (name: string): { command: string; marker: string } => {
  const command = join(temporaryDirectory, `${name}.sh`);
  const marker = `${command}.invoked`;
  writeFileSync(command, '#!/usr/bin/env sh\nprintf invoked > "$0.invoked"\n', "utf8");
  chmodSync(command, 0o755);
  return { command, marker };
};

const listJobs = async (): Promise<EngineJob[]> => {
  const response = await app.request("/runtime/jobs");
  expect(response.status).toBe(200);
  return ((await response.json()) as { jobs: EngineJob[] }).jobs;
};

const awaitTerminalJob = (id: string): Promise<EngineJob> =>
  Effect.runPromise(
    Effect.tryPromise(async () => {
      const response = await app.request(`/runtime/jobs/${id}`);
      if (!response.ok) throw new Error(`Runtime job ${id} was not found`);
      return ((await response.json()) as { job: EngineJob }).job;
    }).pipe(
      Effect.flatMap((job) =>
        terminalStatuses.has(job.status)
          ? Effect.succeed(job)
          : Effect.fail(new Error(`Runtime job ${id} did not reach a terminal state`)),
      ),
      Effect.retry(terminalJobSchedule),
    ),
  );

const postRuntimeJob = async (
  payload: Record<string, unknown>,
): Promise<{ response: Response; body: { job: EngineJob } }> => {
  const response = await app.request("/runtime/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: (await response.json()) as { job: EngineJob } };
};

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-runtime-boundary-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["HOME"] = join(temporaryDirectory, "home");
  process.env["PI_CODING_AGENT_DIR"] = join(temporaryDirectory, "pi");
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_DB_PATH"] = join(temporaryDirectory, "controller.db");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_PORT"] = "18080";
  process.env["LOCAL_STUDIO_INFERENCE_PORT"] = "65534";
  process.env["LOCAL_STUDIO_DISABLE_METRICS"] = "true";
  process.env["LOCAL_STUDIO_RUNTIME_SKIP_DOCKER"] = "1";
  process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] = "1";
  delete process.env["LOCAL_STUDIO_API_KEY"];
  mlxMarker = writeMarkerCommand("mlx-decoy");
  process.env["LOCAL_STUDIO_MLX_PYTHON"] = mlxMarker.command;
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
  runtime = createControllerRuntime();
  context = await runtime.runPromise(AppContextService);
  app = createApp(context, runtime);
});

beforeEach(() => {
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
});

afterAll(async () => {
  await runtime.dispose();
  for (const key of environmentKeys) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("runtime job action boundary", () => {
  const unsupportedTypes = ["inspect", "download"] as const;
  const backends = ["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const;

  for (const type of unsupportedTypes) {
    for (const backend of backends) {
      test(`rejects ${type} for ${backend} before queueing or dispatch`, async () => {
        const marker = writeMarkerCommand(`${backend}-${type}`);
        for (const key of dispatchEnvironmentKeys) process.env[key] = marker.command;
        const jobsBefore = await listJobs();

        const response = await app.request("/runtime/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend, type }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ detail: "Invalid payload" });
        expect(await listJobs()).toEqual(jobsBefore);
        expect(existsSync(marker.marker)).toBe(false);
        expect(existsSync(mlxMarker.marker)).toBe(false);
      });
    }
  }

  for (const type of ["install", "update"] as const) {
    test(`dispatches llama.cpp ${type} only to its engine handler`, async () => {
      const engine = writeMarkerCommand(`llamacpp-${type}`);
      const platform = writeMarkerCommand(`cuda-decoy-${type}`);
      process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;
      process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;

      const { response, body } = await postRuntimeJob({ backend: "llamacpp", type });
      const job = await awaitTerminalJob(body.job.id);

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

  for (const backend of ["cuda", "rocm"] as const) {
    test(`rejects ${backend} install without invoking its update handler`, async () => {
      const platform = writeMarkerCommand(`${backend}-install`);
      process.env[
        backend === "cuda" ? "LOCAL_STUDIO_CUDA_UPGRADE_CMD" : "LOCAL_STUDIO_ROCM_UPGRADE_CMD"
      ] = platform.command;

      const { response, body } = await postRuntimeJob({ backend, type: "install" });
      const job = await awaitTerminalJob(body.job.id);

      expect(response.status).toBe(200);
      expect(job).toMatchObject({
        type: "install",
        status: "error",
        error: `${backend.toUpperCase()} supports update jobs only.`,
      });
      expect(existsSync(platform.marker)).toBe(false);
    });

    test(`dispatches ${backend} update only to its platform handler`, async () => {
      const platform = writeMarkerCommand(`${backend}-update`);
      const engine = writeMarkerCommand(`llamacpp-decoy-${backend}`);
      process.env[
        backend === "cuda" ? "LOCAL_STUDIO_CUDA_UPGRADE_CMD" : "LOCAL_STUDIO_ROCM_UPGRADE_CMD"
      ] = platform.command;
      process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;

      const { response, body } = await postRuntimeJob({ backend, type: "update" });
      const job = await awaitTerminalJob(body.job.id);

      expect(response.status).toBe(200);
      expect(job).toMatchObject({ type: "update", status: "success", command: platform.command });
      expect(existsSync(platform.marker)).toBe(true);
      expect(existsSync(engine.marker)).toBe(false);
    });
  }

  test("defaults an omitted type to update", async () => {
    const platform = writeMarkerCommand("cuda-default-update");
    process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;

    const { response, body } = await postRuntimeJob({ backend: "cuda" });
    const job = await awaitTerminalJob(body.job.id);

    expect(response.status).toBe(200);
    expect(job).toMatchObject({ type: "update", status: "success", command: platform.command });
    expect(existsSync(platform.marker)).toBe(true);
  });

  test("maps explicit upgrade routes to update", async () => {
    const engine = writeMarkerCommand("llamacpp-upgrade-route");
    process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;

    const response = await app.request("/runtime/llamacpp/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "install" }),
    });
    const body = (await response.json()) as { job: EngineJob };
    const job = await awaitTerminalJob(body.job.id);

    expect(response.status).toBe(200);
    expect(job).toMatchObject({ type: "update", status: "success", command: engine.command });
    expect(existsSync(engine.marker)).toBe(true);
  });
});
