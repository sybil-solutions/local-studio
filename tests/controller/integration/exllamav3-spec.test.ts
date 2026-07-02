import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getEngineSpec } from "../../../controller/src/modules/engines/engine-spec";
import type { Config } from "../../../controller/src/config/env";
import type { Recipe } from "../../../controller/src/modules/models/types";

const recipe = (extra: Record<string, unknown> = {}): Recipe =>
  ({
    id: "qwen3-32b-exl3",
    name: "Qwen3 32B EXL3",
    model_path: "/mnt/llm_models/Qwen3-32B-exl3-4bpw",
    backend: "exllamav3",
    host: "127.0.0.1",
    port: 8000,
    served_model_name: null,
    tensor_parallel_size: 1,
    pipeline_parallel_size: 1,
    max_model_len: 32768,
    gpu_memory_utilization: 0.9,
    max_num_seqs: 8,
    kv_cache_dtype: null,
    trust_remote_code: false,
    python_path: null,
    env_vars: {},
    extra_args: extra,
  }) as unknown as Recipe;

const config = {
  data_dir: "/tmp/local-studio-test",
  tabby_api_dir: "/opt/tabbyAPI",
} as Config;

const spec = getEngineSpec("exllamav3");

describe("exllamav3 spec", () => {
  it("builds a TabbyAPI launch command from the configured directory", () => {
    const cmd = spec.buildCommand(recipe(), config);
    expect(cmd[1]).toBe("/opt/tabbyAPI/main.py");
    expect(cmd).toContain("--host");
    expect(cmd).toContain("127.0.0.1");
    expect(cmd).toContain("--port");
    expect(cmd).toContain("8000");
    const nameIndex = cmd.indexOf("--model-name");
    expect(nameIndex).toBeGreaterThan(0);
    expect(cmd[nameIndex + 1]).toBe("Qwen3-32B-exl3-4bpw");
  });

  it("throws a clear error when tabby_api_dir is not configured", () => {
    expect(() => spec.buildCommand(recipe(), { data_dir: "/tmp/x" } as Config)).toThrow(
      /TabbyAPI directory/,
    );
  });

  it("passes extra_args through to the command", () => {
    const cmd = spec.buildCommand(recipe({ "disable-auth": "true" }), config);
    expect(cmd).toContain("--disable-auth");
  });

  it("prefers the python from the TabbyAPI venv when present", () => {
    const tabbyDir = mkdtempSync(join(tmpdir(), "tabby-venv-"));
    const venvBin = join(tabbyDir, "venv", "bin");
    mkdirSync(venvBin, { recursive: true });
    const venvPython = join(venvBin, "python");
    writeFileSync(venvPython, "");
    chmodSync(venvPython, 0o755);
    const cmd = spec.buildCommand(recipe(), {
      data_dir: "/tmp/local-studio-test",
      tabby_api_dir: tabbyDir,
    } as Config);
    expect(cmd[0]).toBe(venvPython);
  });

  it("detects a TabbyAPI invocation", () => {
    expect(
      spec.detectInvocation(["python3", "/opt/tabbyAPI/main.py", "--model-name", "x"]),
    ).toBe(true);
    expect(spec.detectInvocation(["python3", "-m", "vllm.entrypoints.openai.api_server"])).toBe(
      false,
    );
    expect(spec.detectInvocation(["llama-server", "-m", "/models/a.gguf"])).toBe(false);
  });

  it("extracts the served model name from --model-name", () => {
    const args = ["python3", "/opt/tabbyAPI/main.py", "--model-name", "Qwen3-32B-exl3-4bpw"];
    expect(spec.extractServedModelName(args)).toBe("Qwen3-32B-exl3-4bpw");
    expect(spec.extractModelPath(args)).toBe("Qwen3-32B-exl3-4bpw");
  });

  it("reports a not-configured install error without the upgrade env", () => {
    const previous = process.env["LOCAL_STUDIO_EXLLAMAV3_UPGRADE_CMD"];
    delete process.env["LOCAL_STUDIO_EXLLAMAV3_UPGRADE_CMD"];
    return spec.install({ config }).then((result) => {
      if (previous !== undefined) process.env["LOCAL_STUDIO_EXLLAMAV3_UPGRADE_CMD"] = previous;
      expect(result.success).toBe(false);
      expect(result.error).toContain("LOCAL_STUDIO_EXLLAMAV3_UPGRADE_CMD");
    });
  });
});
