import { describe, expect, test } from "bun:test";

import {
  appendExtraArguments,
  appendLlamacppExtraArguments,
  INTERNAL_EXTRA_ARG_KEYS,
  INTERNAL_LLAMACPP_EXTRA_ARG_KEYS,
  JSON_STRING_EXTRA_ARG_KEYS,
} from "../../../shared/command-builder";
import {
  buildBackendCommand,
  buildVllmCommand,
  buildSglangCommand,
  buildLlamacppCommand,
  buildMlxCommand,
} from "../modules/engines/process/backend-builder";
import type { Config } from "../config/env";

const normalizeJsonArgument = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonArgument(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key.replace(/-/g, "_"),
        normalizeJsonArgument(entry),
      ]),
    );
  }
  return value;
};

const BACKEND_ONLY_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "llama_bin",
  "mlx_python",
  "docker_container",
  "docker_image",
  "docker-container",
]);

const BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "llama_bin",
  "docker_container",
  "docker_image",
  "docker-container",
]);

describe("appendExtraArguments", () => {
  test("emits string, number, boolean true, and boolean false values in argv mode", () => {
    const args = appendExtraArguments(
      [],
      {
        string_arg: "hello",
        number_arg: 42,
        bool_true: true,
        bool_false: false,
      },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS },
    );
    expect(args).toEqual([
      "--string-arg",
      "hello",
      "--number-arg",
      "42",
      "--bool-true",
      "--bool-false",
    ]);
  });

  test("skips the enable_expert_parallelism boolean-false exception", () => {
    const args = appendExtraArguments(
      [],
      {
        enable_expert_parallelism: false,
        other_flag: false,
      },
      {
        extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS,
        falseBooleanExceptions: new Set(["enable_expert_parallelism"]),
      },
    );
    expect(args).toEqual(["--other-flag"]);
  });

  test("serializes JSON-string extra args as parsed JSON", () => {
    const args = appendExtraArguments(
      [],
      {
        speculative_config: '{"method":"rejection"}',
      },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS, normalizeJson: normalizeJsonArgument },
    );
    expect(args).toEqual(["--speculative-config", JSON.stringify({ method: "rejection" })]);
  });

  test("falls back to the raw string when JSON-string parsing fails", () => {
    const args = appendExtraArguments(
      [],
      {
        speculative_config: "not-json",
      },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS, normalizeJson: normalizeJsonArgument },
    );
    expect(args).toEqual(["--speculative-config", "not-json"]);
  });

  test("serializes arrays and objects as a single JSON blob", () => {
    const args = appendExtraArguments(
      [],
      {
        lora_adapters: [{ name: "l1" }],
        scalar: "plain",
      },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS, normalizeJson: normalizeJsonArgument },
    );
    expect(args).toEqual([
      "--lora-adapters",
      JSON.stringify([{ name: "l1" }]),
      "--scalar",
      "plain",
    ]);
  });

  test("does not push empty strings in argv mode by default", () => {
    const args = appendExtraArguments(
      [],
      { empty_string: "" },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS },
    );
    expect(args).toEqual(["--empty-string", ""]);
  });

  test("shell-quoted mode wraps strings and JSON values for preview", () => {
    const args = appendExtraArguments(
      [],
      {
        string_arg: "hello",
        speculative_config: '{"method":"rejection"}',
        lora_adapters: [{ name: "l1" }],
      },
      { shellQuoting: true, skipEmptyString: true },
    );
    expect(args).toEqual([
      "--string-arg hello",
      `--speculative-config '${JSON.stringify({ method: "rejection" })}'`,
      `--lora-adapters '${JSON.stringify([{ name: "l1" }])}'`,
    ]);
  });

  test("filters shared internal keys", () => {
    const args = appendExtraArguments(
      [],
      {
        venv_path: "/env",
        launch_command: "echo hi",
        visible_arg: "yes",
      },
      { shellQuoting: true, skipEmptyString: true },
    );
    expect(args).toEqual(["--visible-arg yes"]);
  });

  test("filters backend-only internal keys", () => {
    const args = appendExtraArguments(
      [],
      {
        llama_bin: "/bin/llama-server",
        docker_container: "foo",
        visible_arg: "yes",
      },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS },
    );
    expect(args).toEqual(["--visible-arg", "yes"]);
  });

  test("dedupes flags already present in argv", () => {
    const args = appendExtraArguments(
      ["--visible-arg", "first"],
      { visible_arg: "second" },
      { extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS },
    );
    expect(args).toEqual(["--visible-arg", "first"]);
  });

  test("dedupes flags already present in shell-quoted combined args", () => {
    const args = appendExtraArguments(
      ["--visible-arg first"],
      { visible_arg: "second" },
      { shellQuoting: true, skipEmptyString: true },
    );
    expect(args).toEqual(["--visible-arg first"]);
  });
});

describe("appendLlamacppExtraArguments", () => {
  test("iterates arrays and skips boolean false", () => {
    const args = appendLlamacppExtraArguments(
      [],
      {
        tensor_split: [0.5, 0.5],
        no_mmap: false,
        ctx_size: 4096,
      },
      { extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS, skipEmptyString: true },
    );
    expect(args).toEqual([
      "--tensor-split",
      "0.5",
      "--tensor-split",
      "0.5",
      "--ctx-size",
      "4096",
    ]);
  });

  test("serializes objects as JSON", () => {
    const args = appendLlamacppExtraArguments(
      [],
      { sampling_json: { temperature: 0.5 } },
      { extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS, skipEmptyString: true },
    );
    expect(args).toEqual(["--sampling-json", JSON.stringify({ temperature: 0.5 })]);
  });

  test("shell-quoted mode emits combined flag-value strings", () => {
    const args = appendLlamacppExtraArguments(
      [],
      {
        tensor_split: [0.5, 0.5],
        sampling_json: { temperature: 0.5 },
        ctx_size: 4096,
      },
      {
        extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS,
        shellQuoting: true,
        skipEmptyString: true,
      },
    );
    expect(args).toEqual([
      "--tensor-split 0.5",
      "--tensor-split 0.5",
      `--sampling-json '${JSON.stringify({ temperature: 0.5 })}'`,
      "--ctx-size 4096",
    ]);
  });

  test("filters shared and backend-only internal keys", () => {
    const args = appendLlamacppExtraArguments(
      [],
      {
        venv_path: "/env",
        llama_bin: "/bin/llama-server",
        visible_arg: "yes",
      },
      { extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS, skipEmptyString: true },
    );
    expect(args).toEqual(["--visible-arg", "yes"]);
  });

  test("skips empty strings when requested", () => {
    const args = appendLlamacppExtraArguments(
      [],
      { tensor_split: ["", "0.5"], empty: "" },
      { extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS, skipEmptyString: true },
    );
    expect(args).toEqual(["--tensor-split", "0.5"]);
  });
});

describe("exported key tables", () => {
  test("JSON_STRING_EXTRA_ARG_KEYS contains the known JSON-string keys", () => {
    expect(JSON_STRING_EXTRA_ARG_KEYS["speculative_config"]).toBe(true);
    expect(JSON_STRING_EXTRA_ARG_KEYS["default_chat_template_kwargs"]).toBe(true);
  });

  test("INTERNAL_EXTRA_ARG_KEYS contains the frontend/backend common vllm/sglang keys", () => {
    expect(INTERNAL_EXTRA_ARG_KEYS["launch_command"]).toBe(true);
    expect(INTERNAL_EXTRA_ARG_KEYS["custom_command"]).toBe(true);
    expect(INTERNAL_EXTRA_ARG_KEYS["llama_bin"]).toBeUndefined();
  });

  test("INTERNAL_LLAMACPP_EXTRA_ARG_KEYS contains the common llama.cpp keys", () => {
    expect(INTERNAL_LLAMACPP_EXTRA_ARG_KEYS["status"]).toBe(true);
    expect(INTERNAL_LLAMACPP_EXTRA_ARG_KEYS["llama_bin"]).toBeUndefined();
  });
});

const minimalConfig: Config = {
  host: "127.0.0.1",
  port: 8000,
  inference_host: "127.0.0.1",
  inference_port: 8001,
  data_dir: "/tmp",
  db_path: "/tmp/test.db",
  models_dir: "/tmp/models",
  strict_openai_models: false,
  providers: [],
};

const baseRecipe = {
  id: "test" as never,
  name: "Test",
  model_path: "/models/model",
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 256,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "0.0.0.0",
  port: 8000,
  served_model_name: null,
  python_path: null,
  extra_args: {
    string_arg: "hello",
    number_arg: 42,
    bool_true: true,
    bool_false: false,
    speculative_config: '{"method":"rejection"}',
    lora_adapters: [{ name: "l1" }],
    internal_key: "hidden",
  },
  max_thinking_tokens: null,
  thinking_mode: "conservative",
};

describe("shared serializer parity with backend-builder", () => {
  test("vllm shared args are contained in the built command", () => {
    const recipe = { ...baseRecipe, backend: "vllm" as never };
    const command = buildVllmCommand(recipe);
    const shared = appendExtraArguments(
      [],
      recipe.extra_args,
      {
        extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS,
        normalizeJson: normalizeJsonArgument,
        falseBooleanExceptions: new Set(["enable_expert_parallelism"]),
      },
    );
    for (const arg of shared) {
      expect(command).toContain(arg);
    }
  });

  test("sglang shared args are contained in the built command", () => {
    const recipe = { ...baseRecipe, backend: "sglang" as never };
    const command = buildSglangCommand(recipe, minimalConfig);
    const shared = appendExtraArguments(
      [],
      recipe.extra_args,
      {
        extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS,
        normalizeJson: normalizeJsonArgument,
        falseBooleanExceptions: new Set(["enable_expert_parallelism"]),
      },
    );
    for (const arg of shared) {
      expect(command).toContain(arg);
    }
  });

  test("llamacpp shared args are contained in the built command", () => {
    const recipe = { ...baseRecipe, backend: "llamacpp" as never };
    const command = buildLlamacppCommand(recipe, minimalConfig);
    const shared = appendLlamacppExtraArguments(
      [],
      recipe.extra_args,
      {
        extraInternalKeys: BACKEND_ONLY_LLAMACPP_INTERNAL_KEYS,
        skipEmptyString: true,
      },
    );
    for (const arg of shared) {
      expect(command).toContain(arg);
    }
  });

  test("mlx shared args are contained in the built command", () => {
    const recipe = { ...baseRecipe, backend: "mlx" as never };
    const command = buildMlxCommand(recipe, minimalConfig);
    const shared = appendExtraArguments(
      [],
      recipe.extra_args,
      {
        extraInternalKeys: BACKEND_ONLY_INTERNAL_KEYS,
        normalizeJson: normalizeJsonArgument,
        falseBooleanExceptions: new Set(["enable_expert_parallelism"]),
      },
    );
    for (const arg of shared) {
      expect(command).toContain(arg);
    }
  });

  test("buildBackendCommand uses the shared extra-args logic for launch overrides", () => {
    const recipe = {
      ...baseRecipe,
      backend: "vllm" as never,
      extra_args: {
        ...baseRecipe.extra_args,
        launch_command: 'echo "override"',
      },
    };
    process.env["VLLM_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const command = buildBackendCommand(recipe, minimalConfig);
    delete process.env["VLLM_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"];
    expect(command).toEqual(["echo", "override"]);
  });
});
