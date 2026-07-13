import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConfig } from "../../src/config/env";
import { createLogger } from "../../src/core/logger";
import { createProcessManager } from "../../src/modules/engines/process/process-manager";
import type { Recipe } from "../../src/modules/models/types";
import { FakeProcessRunner } from "../support/fake-process-runner";
import { registerControllerTestLifecycle, tempDir } from "./fixtures";

registerControllerTestLifecycle();

const LAUNCH_TIMEOUT_MS = 10_000;

const testVllmBinary = (): string => {
  const binary = join(tempDir, "bin", "vllm");
  mkdirSync(join(tempDir, "bin"), { recursive: true });
  writeFileSync(binary, "");
  chmodSync(binary, 0o755);
  return binary;
};

const vllmRecipe = (
  id: string,
  runtime: Recipe["runtime"] = { kind: "system", ref: testVllmBinary() },
  extraArguments: Record<string, unknown> = {},
): Recipe => ({
  id,
  name: id,
  model_path: join(tempDir, "models", "test-model"),
  backend: "vllm",
  runtime,
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.8,
  kv_cache_dtype: "auto",
  max_num_seqs: 8,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "127.0.0.1",
  port: 8000,
  served_model_name: "test-model",
  python_path: null,
  extra_args: extraArguments,
  max_thinking_tokens: null,
  thinking_mode: null,
});

const createManager = (runner: FakeProcessRunner) => {
  const config = createConfig();
  return {
    config,
    manager: createProcessManager(config, createLogger("error"), undefined, runner),
  };
};

const onlySpawn = (runner: FakeProcessRunner) => {
  const spawns = runner.spawns();
  expect(spawns).toHaveLength(1);
  const spawn = spawns[0];
  if (!spawn) throw new Error("Expected one process spawn");
  return spawn;
};

describe("process manager launch/stop via the process seam", () => {
  test(
    "launchModel spawns the selected vLLM runtime argv, reports the pid, and stops",
    async () => {
      const runner = new FakeProcessRunner();
      const { config, manager } = createManager(runner);
      const recipe = vllmRecipe("vllm-argv");

      const result = await manager.launchModel(recipe);

      expect(result.success).toBe(true);
      expect(result.pid).toBe(42_001);
      expect(result.log_file).toBe(join(config.data_dir, "logs", "vllm_vllm-argv.log"));

      const spawn = onlySpawn(runner);
      expect(spawn.command.split("/").at(-1)).toBe("vllm");
      expect(spawn.args).toEqual([
        "serve",
        recipe.model_path,
        "--host",
        "127.0.0.1",
        "--port",
        String(config.inference_port),
        "--served-model-name",
        "test-model",
        "--max-model-len",
        "4096",
        "--gpu-memory-utilization",
        "0.8",
        "--max-num-seqs",
        "8",
      ]);
      expect(
        runner.invocations.some(
          (invocation) => invocation.kind === "runSync" && invocation.command === "ps",
        ),
      ).toBe(true);
      if (result.pid === null) throw new Error("Expected launched process pid");
      await expect(manager.killProcess(result.pid, false)).resolves.toBe(true);
    },
    LAUNCH_TIMEOUT_MS,
  );

  test(
    "docker runtime removes the stale container and spawns the exact docker argv",
    async () => {
      const runner = new FakeProcessRunner();
      const { config, manager } = createManager(runner);
      const image = "vllm/vllm-custom:test";
      const recipe = vllmRecipe("vllm-docker", { kind: "docker", ref: image });

      const result = await manager.launchModel(recipe);
      expect(result.success).toBe(true);
      expect(runner.invocations).toContainEqual({
        kind: "runSync",
        command: "docker",
        args: ["rm", "-f", "local-studio-vllm-docker"],
      });

      const spawn = onlySpawn(runner);
      expect(spawn.command).toBe("docker");
      expect(spawn.args).toEqual([
        "run",
        "--rm",
        "--name",
        "local-studio-vllm-docker",
        "--gpus",
        "all",
        "--network",
        "host",
        "--ipc",
        "host",
        "--shm-size",
        "32g",
        "--ulimit",
        "memlock=-1",
        "--ulimit",
        "stack=67108864",
        "-e",
        "XDG_CACHE_HOME=/cache/jit",
        "-e",
        "CUDA_CACHE_PATH=/cache/jit",
        "-e",
        "VLLM_CACHE_DIR=/cache/jit/vllm",
        "-e",
        "TRITON_CACHE_DIR=/cache/jit/triton",
        "-v",
        `${recipe.model_path}:${recipe.model_path}:ro`,
        "-v",
        "local-studio-jit-vllm-docker:/cache/jit",
        image,
        "/opt/venv/bin/vllm",
        "serve",
        recipe.model_path,
        "--host",
        "127.0.0.1",
        "--port",
        String(config.inference_port),
        "--served-model-name",
        "test-model",
        "--max-model-len",
        "4096",
        "--gpu-memory-utilization",
        "0.8",
        "--max-num-seqs",
        "8",
      ]);
    },
    LAUNCH_TIMEOUT_MS,
  );

  test(
    "docker runtime receives the coordinator's exact canonical UUID set",
    async () => {
      const runner = new FakeProcessRunner();
      const { manager } = createManager(runner);
      const image = "vllm/vllm-custom:test";
      const recipe = vllmRecipe(
        "vllm-docker-uuids",
        { kind: "docker", ref: image },
        { visible_devices: "3", env_vars: { CUDA_VISIBLE_DEVICES: "3" } },
      );
      const gpuUuids = [
        "GPU-00000000-0000-0000-0000-000000000001",
        "GPU-00000000-0000-0000-0000-000000000002",
        "GPU-00000000-0000-0000-0000-000000000003",
        "GPU-00000000-0000-0000-0000-000000000004",
      ];

      const result = await manager.launchModel(recipe, { gpuUuids });

      expect(result.success).toBe(true);
      const selector = gpuUuids.join(",");
      const spawn = onlySpawn(runner);
      expect(spawn.args.slice(4, 8)).toEqual([
        "--gpus",
        `"device=${selector}"`,
        "-e",
        `CUDA_VISIBLE_DEVICES=${selector}`,
      ]);
    },
    LAUNCH_TIMEOUT_MS,
  );

  test("managed GPU selection rejects a custom launch command", async () => {
    const runner = new FakeProcessRunner();
    const { manager } = createManager(runner);
    const key = "LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND";
    const previous = process.env[key];
    process.env[key] = "true";
    try {
      const result = await manager.launchModel(
        vllmRecipe("vllm-custom-gpu", undefined, {
          launch_command: "docker run --gpus all unsafe-image",
        }),
        { gpuUuids: ["GPU-00000000-0000-0000-0000-000000000001"] },
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Custom launch commands cannot use managed GPU selection");
      expect(runner.spawns()).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  test("stop confirmation cleans and retains known orphan workers", async () => {
    const pid = 2_147_483_000;
    const runner = new FakeProcessRunner().onRunSync(
      (command, args) => command === "ps" && args.includes("pid=,ppid=,stat=,args="),
      { stdout: `${pid} 1 S VLLM::Worker` },
    );
    const { manager } = createManager(runner);

    await expect(manager.confirmInferenceStopped(8000)).resolves.toBe(false);
    expect(runner.invocations).toContainEqual({
      kind: "runSync",
      command: "sudo",
      args: ["-n", "kill", "-SIGTERM", String(pid)],
    });
  });

  test(
    "a fast-failing launch surfaces the exit code and captured output",
    async () => {
      const runner = new FakeProcessRunner().onSpawn("vllm", {
        exitCode: 2,
        exitAfterMs: 50,
        stderrLines: ["usage: vllm serve", "error: unrecognized arguments: --bogus-flag"],
      });
      const { manager } = createManager(runner);

      const result = await manager.launchModel(vllmRecipe("vllm-early-exit"));

      expect(result.success).toBe(false);
      expect(result.pid).toBeNull();
      expect(result.message).toContain("Process exited early (code 2)");
      expect(result.message).toContain("unrecognized arguments: --bogus-flag");
    },
    LAUNCH_TIMEOUT_MS,
  );

  test(
    "a spawn error is surfaced as a failed launch",
    async () => {
      const runner = new FakeProcessRunner().onSpawn("vllm", {
        spawnError: "spawn vllm ENOENT",
      });
      const { manager } = createManager(runner);

      const result = await manager.launchModel(vllmRecipe("vllm-enoent"));

      expect(result.success).toBe(false);
      expect(result.pid).toBeNull();
      expect(result.message).toContain("ENOENT");
    },
    LAUNCH_TIMEOUT_MS,
  );
});
