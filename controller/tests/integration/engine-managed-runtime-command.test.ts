import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConfig } from "../../src/config/env";
import { getEngineSpec } from "../../src/modules/engines/engine-spec";
import {
  managedVenvPython,
  venvConsoleScriptPath,
} from "../../src/modules/engines/runtimes/managed-venv";
import type { Recipe } from "../../src/modules/models/types";
import { registerControllerTestLifecycle, tempDir } from "./fixtures";

registerControllerTestLifecycle();

const baseRecipe = (backend: Recipe["backend"]): Recipe => ({
  id: `${backend}-managed-command`,
  name: `${backend} Managed Command`,
  model_path: join(tempDir, "models", `${backend}-model`),
  backend,
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
  served_model_name: `${backend}-model`,
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: null,
});

const writeExecutable = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/usr/bin/env sh\nexit 0\n", "utf8");
  chmodSync(path, 0o755);
};

describe("managed runtime launch commands", () => {
  test("sglang launch prefers the controller-managed CLI", () => {
    const config = createConfig();
    const python = managedVenvPython(config, "sglang");
    const sglang = venvConsoleScriptPath(python, "sglang");
    writeExecutable(python);
    writeExecutable(sglang);

    const command = getEngineSpec("sglang").buildCommand(baseRecipe("sglang"), config);

    expect(command.slice(0, 2)).toEqual([sglang, "serve"]);
  });

  test("mlx launch prefers the controller-managed Python", () => {
    const config = createConfig();
    const python = managedVenvPython(config, "mlx");
    writeExecutable(python);

    const command = getEngineSpec("mlx").buildCommand(baseRecipe("mlx"), config);

    expect(command.slice(0, 3)).toEqual([python, "-m", "mlx_lm.server"]);
  });
});
