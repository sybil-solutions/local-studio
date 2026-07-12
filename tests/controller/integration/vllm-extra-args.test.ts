import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { appendExtraArguments } from "../../../controller/src/modules/engines/process/backend-builder";
import { appendLlamacppArguments } from "../../../controller/src/modules/engines/specs/llamacpp-spec";
import { appendVllmExtraArguments } from "../../../controller/src/modules/engines/specs/vllm-spec";

describe("CLI extra_args serialization", () => {
  const extraArguments = {
    "existing-flag": "ignored",
    enabled: true,
    disabled: false,
    enable_expert_parallelism: false,
    empty: "",
    list: ["first", "second"],
    object: { "nested-key": 1 },
    description: "internal",
    missing: null,
  };

  it("preserves the generic backend argument policy", () => {
    const command = ["runtime", "--existing-flag", "original"];

    appendExtraArguments(command, extraArguments);

    expect(command).toEqual([
      "runtime",
      "--existing-flag",
      "original",
      "--enabled",
      "--disabled",
      "--empty",
      "",
      "--list",
      '["first","second"]',
      "--object",
      '{"nested_key":1}',
    ]);
  });

  it("preserves the llama.cpp argument policy", () => {
    const command = ["llama-server", "--existing-flag", "original"];

    appendLlamacppArguments(command, extraArguments);

    expect(command).toEqual([
      "llama-server",
      "--existing-flag",
      "original",
      "--enabled",
      "--list",
      "first",
      "--list",
      "second",
      "--object",
      '{"nested-key":1}',
    ]);
  });
});

describe("vLLM extra_args allowlist", () => {
  let savedAllow: string | undefined;
  let savedStrict: string | undefined;
  const captured: unknown[][] = [];

  const fmt = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const recordWarn = (...args: unknown[]) => {
    captured.push(["warn", ...args.map(fmt)]);
  };

  beforeEach(() => {
    savedAllow = process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"];
    savedStrict = process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"];
    delete process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"];
    delete process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"];
    captured.length = 0;
  });

  afterEach(() => {
    if (savedAllow === undefined) delete process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"];
    else process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"] = savedAllow;
    if (savedStrict === undefined) delete process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"];
    else process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"] = savedStrict;
  });

  it("forwards known vLLM flags without modification", () => {
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(command, {
      "attention-backend": "B12X_MLA_SPARSE",
      "moe-backend": "b12x",
      "enable-prefix-caching": true,
      "dcp-comm-backend": "ag_rs",
      "hf-overrides": { index_topk_pattern: "FFF" },
    });

    expect(command).toContain("--attention-backend");
    expect(command[command.indexOf("--attention-backend") + 1]).toBe("B12X_MLA_SPARSE");
    expect(command).toContain("--moe-backend");
    expect(command).toContain("--enable-prefix-caching");
    expect(command).toContain("--dcp-comm-backend");
    expect(command[command.indexOf("--dcp-comm-backend") + 1]).toBe("ag_rs");
    expect(command).toContain("--hf-overrides");
  });

  it("forwards fork-specific experimental flags by prefix", () => {
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(command, {
      "b12x-fused-moe-ar": true,
      "darkdevotion-no-eos-fix": true,
      "cute-dsl-arch": "sm_120a",
    });

    expect(command).toContain("--b12x-fused-moe-ar");
    expect(command).toContain("--darkdevotion-no-eos-fix");
    expect(command).toContain("--cute-dsl-arch");
  });

  it("drops unknown non-notes keys", () => {
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(command, {
      "totally-fake-flag": "value",
    });

    expect(command).not.toContain("--totally-fake-flag");
    expect(command).not.toContain("value");
  });

  it("drops timestamped notes-style keys (the glm-5-2-504b-term crash regression)", () => {
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(
      command,
      {
        benchmark_notes_20260622: {
          recommended_dcp: 2,
          decode_tok_s_1024: 63.806,
          dcp2_262144_failure: "needs 6.68 GiB KV, available 6.28 GiB",
        },
        "attention-backend": "B12X_MLA_SPARSE",
      },
      // synthesise a logger so the test asserts on the warning shape
      { debug: () => {}, info: () => {}, warn: recordWarn, error: () => {} } as never,
    );

    expect(command).not.toContain("--benchmark-notes-20260622");
    expect(command.join(" ")).not.toContain("needs 6.68 GiB KV");
    expect(command).toContain("--attention-backend");

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const [, , detail] = captured[0] ?? [];
    expect(String(detail ?? "")).toContain("benchmark_notes_20260622");
    expect(String(detail ?? "")).toContain(
      "store notes under recipe.description or recipe.metadata",
    );
  });

  it("skips internal keys (description, env_vars, tags, ...)", () => {
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendExtraArguments(command, {
      description: "GLM-5.2-NVFP4-REAP-504B on 4x B12X",
      env_vars: { NCCL_P2P_DISABLE: "1" },
      tags: ["504b", "b12x"],
      "attention-backend": "B12X_MLA_SPARSE",
    });

    expect(command).not.toContain("--description");
    expect(command).not.toContain("--env-vars");
    expect(command).not.toContain("--tags");
    expect(command).toContain("--attention-backend");
  });

  it("escape hatch LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS=true forwards everything", () => {
    process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"] = "true";
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(command, {
      benchmark_notes_20260622: { foo: 1 },
      "made-up-flag": "yes",
    });

    expect(command).toContain("--benchmark-notes-20260622");
    expect(command).toContain("--made-up-flag");
    expect(captured.length).toBe(0);
  });

  it("strict mode still drops unknown keys", () => {
    process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"] = "true";
    const command = ["/opt/venv/bin/vllm", "serve", "/models/test"];
    appendVllmExtraArguments(command, {
      "totally-fake-flag": "value",
      "attention-backend": "B12X_MLA_SPARSE",
    });

    expect(command).not.toContain("--totally-fake-flag");
    expect(command).toContain("--attention-backend");
  });
});
