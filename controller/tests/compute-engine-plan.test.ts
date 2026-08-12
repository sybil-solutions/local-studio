import { describe, expect, test } from "bun:test";
import type {
  Accelerator,
  HostProfile,
  LaunchRequest,
  EngineRuntimeKind,
  ServingOptions,
} from "../src/modules/compute/contracts";
import { ENGINE_IDS } from "../src/modules/compute/contracts";
import { deviceEnvironment, dockerFlagsFor } from "../src/modules/compute/engines/devices";
import {
  availableEngines,
  engineSpec,
  planLaunch,
  supportsRuntime,
} from "../src/modules/compute/engines/registry";
import { mergeArguments } from "../src/modules/compute/engines/shared";

const host = (overrides: Partial<HostProfile> = {}): HostProfile => ({
  nodeId: "self",
  platform: "linux",
  arch: "x64",
  accelerator: "cuda",
  unifiedMemory: false,
  wsl: false,
  docker: true,
  dockerGpu: true,
  deviceCount: 2,
  ...overrides,
});

const options = (overrides: Partial<ServingOptions> = {}): ServingOptions => ({
  tensorParallel: 1,
  pipelineParallel: 1,
  maxContextLength: 8192,
  memoryFraction: 0.9,
  maxConcurrentRequests: 64,
  kvCacheDtype: "auto",
  dtype: null,
  quantization: null,
  trustRemoteCode: false,
  toolCallParser: null,
  reasoningParser: null,
  ...overrides,
});

const request = (overrides: Partial<LaunchRequest> = {}): LaunchRequest => ({
  engine: "vllm",
  host: host(),
  runtime: "process",
  devices: ["GPU-aaa", "GPU-bbb"],
  port: 8000,
  modelPath: "/models/qwen",
  servedModelName: "qwen",
  options: options(),
  extraArgs: [],
  env: {},
  dockerImage: null,
  binary: "/venv/bin/vllm",
  wslDistribution: null,
  ...overrides,
});

describe("plan() is pure", () => {
  test("same request produces identical plans", () => {
    const input = request();
    expect(planLaunch(input)).toEqual(planLaunch(input));
  });

  test("every engine emits the model, the port and the devices", () => {
    for (const id of ENGINE_IDS) {
      const spec = engineSpec(id);
      const plan = planLaunch(
        request({ engine: id, host: host({ accelerator: "cuda" }), binary: spec.defaultBinary }),
      );
      expect(plan.argv).toContain("/models/qwen");
      expect(plan.argv).toContain("8000");
      expect(plan.devices).toEqual(["GPU-aaa", "GPU-bbb"]);
      expect(plan.health.path.startsWith("/")).toBe(true);
    }
  });
});

describe("tuning knobs", () => {
  test("vLLM and SGLang spell the same knobs differently", () => {
    const tuned = options({
      tensorParallel: 4,
      maxContextLength: 32768,
      memoryFraction: 0.92,
      toolCallParser: "hermes",
    });
    const vllmArgs = planLaunch(request({ engine: "vllm", options: tuned })).argv;
    const sglangArgs = planLaunch(
      request({ engine: "sglang", binary: "sglang", options: tuned, port: 30000 }),
    ).argv;

    expect(vllmArgs).toContain("--tensor-parallel-size");
    expect(vllmArgs).toContain("--max-model-len");
    expect(vllmArgs).toContain("--gpu-memory-utilization");
    // vLLM needs the companion flag next to the parser; SGLang does not.
    expect(vllmArgs).toContain("--enable-auto-tool-choice");

    expect(sglangArgs).toContain("--context-length");
    expect(sglangArgs.slice(0, 2)).toEqual(["sglang", "serve"]);
    expect(sglangArgs).toContain("--mem-fraction-static");
    expect(sglangArgs).not.toContain("--enable-auto-tool-choice");
    expect(sglangArgs).not.toContain("--max-model-len");
  });

  test("parallelism of 1 is omitted, above 1 is emitted", () => {
    expect(planLaunch(request({ options: options({ tensorParallel: 1 }) })).argv).not.toContain(
      "--tensor-parallel-size",
    );
    expect(planLaunch(request({ options: options({ tensorParallel: 2 }) })).argv).toContain(
      "--tensor-parallel-size",
    );
  });

  test('kvCacheDtype "auto" is treated as unset', () => {
    expect(planLaunch(request({ options: options({ kvCacheDtype: "auto" }) })).argv).not.toContain(
      "--kv-cache-dtype",
    );
    expect(planLaunch(request({ options: options({ kvCacheDtype: "fp8" }) })).argv).toContain(
      "--kv-cache-dtype",
    );
  });

  test("knobs an engine has no equivalent for are dropped, not approximated", () => {
    const argv = planLaunch(
      request({
        engine: "llamacpp",
        binary: "llama-server",
        options: options({ tensorParallel: 4, kvCacheDtype: "fp8", quantization: "awq" }),
      }),
    ).argv;
    expect(argv).not.toContain("--tensor-parallel-size");
    expect(argv).not.toContain("--split-mode");
    expect(argv).not.toContain("--cache-type-k");
    expect(argv).not.toContain("--quantization");
    expect(argv).toContain("--ctx-size");
  });
});

describe("extraArgs override the base flags", () => {
  test("a repeated flag appears once, with the recipe's value", () => {
    const argv = planLaunch(
      request({ options: options({ maxContextLength: 8192 }), extraArgs: ["--max-model-len", "4096"] }),
    ).argv;
    expect(argv.filter((token) => token === "--max-model-len")).toHaveLength(1);
    expect(argv[argv.indexOf("--max-model-len") + 1]).toBe("4096");
    expect(argv).not.toContain("8192");
  });

  test("mergeArguments drops the base flag and its value", () => {
    expect(mergeArguments(["--a", "1", "--b", "2"], ["--a", "9"])).toEqual(["--b", "2", "--a", "9"]);
  });

  test("mergeArguments handles boolean flags and --flag=value form", () => {
    expect(mergeArguments(["--verbose", "--b", "2"], ["--verbose"])).toEqual(["--b", "2", "--verbose"]);
    expect(mergeArguments(["--a=1", "--b", "2"], ["--a", "9"])).toEqual(["--b", "2", "--a", "9"]);
  });

  test("SGLang's --enable-metrics default can be overridden", () => {
    const argv = planLaunch(
      request({ engine: "sglang", port: 30000, extraArgs: ["--enable-metrics", "false"] }),
    ).argv;
    expect(argv.filter((token) => token === "--enable-metrics")).toHaveLength(1);
  });
});

describe("docker vs process", () => {
  test("a container gets the image, the mount and 0.0.0.0; a process gets the binary", () => {
    const asProcess = planLaunch(request({ runtime: "process" }));
    const asDocker = planLaunch(request({ runtime: "docker" }));

    expect(asProcess.argv[0]).toBe("/venv/bin/vllm");
    expect(asProcess.argv[1]).toBe("serve");
    expect(asProcess.image).toBeUndefined();
    expect(asProcess.mounts).toEqual([]);
    expect(asProcess.argv[asProcess.argv.indexOf("--host") + 1]).toBe("127.0.0.1");

    expect(asDocker.argv[0]).not.toBe("/venv/bin/vllm");
    expect(asDocker.argv).not.toContain("serve");
    expect(asDocker.image).toBe("vllm/vllm-openai:latest");
    expect(asDocker.mounts).toEqual([{ from: "/models/qwen", to: "/models", readOnly: true }]);
    expect(asDocker.argv[asDocker.argv.indexOf("--host") + 1]).toBe("0.0.0.0");
    // The container sees the model at the mount point, not the host path.
    expect(asDocker.argv).toContain("/models");
  });

  test("a recipe-selected container image overrides the engine default", () => {
    const customImage = "registry.example/sglang:deepseek-v4";
    const asDocker = planLaunch(
      request({ engine: "sglang", runtime: "docker", dockerImage: customImage }),
    );

    expect(asDocker.image).toBe(customImage);
  });

  test("vLLM uses the WSL2-compatible runner unless the recipe overrides it", () => {
    const defaultPlan = engineSpec("vllm").plan(
      request({ runtime: "wsl2", wslDistribution: "Ubuntu" }),
    );
    const overriddenPlan = engineSpec("vllm").plan(
      request({
        runtime: "wsl2",
        wslDistribution: "Ubuntu",
        env: { VLLM_USE_V2_MODEL_RUNNER: "1" },
      }),
    );
    const nativePlan = engineSpec("vllm").plan(request({ runtime: "process" }));

    expect(defaultPlan.env["VLLM_USE_V2_MODEL_RUNNER"]).toBe("0");
    expect(overriddenPlan.env["VLLM_USE_V2_MODEL_RUNNER"]).toBe("1");
    expect(nativePlan.env["VLLM_USE_V2_MODEL_RUNNER"]).toBeUndefined();
  });
});

describe("device translation", () => {
  const devices = ["GPU-aaa", "GPU-bbb"];

  test("each accelerator selects devices its own way", () => {
    expect(deviceEnvironment("cuda", devices)).toEqual({ CUDA_VISIBLE_DEVICES: "GPU-aaa,GPU-bbb" });
    expect(deviceEnvironment("rocm", ["gpu:0", "gpu:1"])).toEqual({
      HIP_VISIBLE_DEVICES: "0,1",
      ROCR_VISIBLE_DEVICES: "0,1",
    });
    expect(deviceEnvironment("xpu", ["xpu:0"])).toEqual({ ONEAPI_DEVICE_SELECTOR: "level_zero:0" });
    // Metal exposes no device selection and CPU has nothing to select.
    expect(deviceEnvironment("metal", ["metal:0"])).toEqual({});
    expect(deviceEnvironment("cpu", ["cpu:0"])).toEqual({});
  });

  test("no devices means no environment, for every accelerator", () => {
    const accelerators: Accelerator[] = ["cuda", "rocm", "metal", "xpu", "cpu"];
    for (const accelerator of accelerators) {
      expect(deviceEnvironment(accelerator, [])).toEqual({});
      expect(dockerFlagsFor(accelerator, []).args).toEqual([]);
    }
  });

  test("docker flags differ from process env", () => {
    expect(dockerFlagsFor("cuda", devices).args).toEqual([
      "--gpus",
      '"device=GPU-aaa,GPU-bbb"',
    ]);
    expect(dockerFlagsFor("rocm", devices).args).toContain("/dev/kfd");
    expect(dockerFlagsFor("rocm", devices).groupAdd).toEqual(["video", "render"]);
  });

  test("planLaunch folds device selection in exactly once", () => {
    const plan = planLaunch(request());
    expect(plan.env["CUDA_VISIBLE_DEVICES"]).toBe("GPU-aaa,GPU-bbb");
    // The engine must not have written it itself.
    expect(engineSpec("vllm").plan(request()).env["CUDA_VISIBLE_DEVICES"]).toBeUndefined();
  });
});

describe("supports() gates by host", () => {
  const cases: readonly {
    readonly engine: (typeof ENGINE_IDS)[number];
    readonly host: HostProfile;
    readonly ok: boolean;
    readonly runtime?: EngineRuntimeKind;
  }[] = [
    { engine: "vllm", host: host({ accelerator: "cuda" }), ok: true, runtime: "process" },
    { engine: "vllm", host: host({ platform: "darwin", accelerator: "metal" }), ok: false },
    { engine: "vllm", host: host({ platform: "win32", accelerator: "cuda", wsl: false }), ok: false },
    {
      engine: "vllm",
      host: host({ platform: "win32", accelerator: "cuda", wsl: true }),
      ok: true,
      runtime: "wsl2",
    },
    { engine: "vllm", host: host({ accelerator: "rocm" }), ok: true, runtime: "docker" },
    { engine: "sglang", host: host({ accelerator: "rocm" }), ok: false },
    {
      engine: "sglang",
      host: host({ platform: "win32", accelerator: "cuda", wsl: true }),
      ok: true,
      runtime: "wsl2",
    },
    { engine: "mlx", host: host({ platform: "darwin", arch: "arm64", accelerator: "metal" }), ok: true, runtime: "process" },
    { engine: "mlx", host: host({ platform: "linux" }), ok: false },
    { engine: "mlx", host: host({ platform: "darwin", arch: "x64", accelerator: "metal" }), ok: false },
    { engine: "llamacpp", host: host({ platform: "darwin", accelerator: "metal" }), ok: true, runtime: "process" },
    { engine: "llamacpp", host: host({ platform: "win32", accelerator: "cuda", dockerGpu: true }), ok: true, runtime: "process" },
    { engine: "exllamav3", host: host({ accelerator: "cuda" }), ok: true, runtime: "process" },
    { engine: "exllamav3", host: host({ platform: "win32", accelerator: "cuda" }), ok: false },
    { engine: "exllamav3", host: host({ accelerator: "rocm" }), ok: false },
  ];

  for (const testCase of cases) {
    const label = `${testCase.engine} on ${testCase.host.platform}/${testCase.host.accelerator}${testCase.host.wsl ? "+wsl" : ""}/${testCase.host.arch}`;
    test(`${label} -> ${testCase.ok ? "supported" : "refused"}`, () => {
      const support = engineSpec(testCase.engine).supports(testCase.host);
      expect(support.ok).toBe(testCase.ok);
      if (!support.ok) {
        // A refusal must say why, so the UI never has to invent a reason.
        expect(support.reason.length).toBeGreaterThan(10);
        return;
      }
      if (testCase.runtime) {
        expect(supportsRuntime(testCase.engine, testCase.host, testCase.runtime)).toBe(true);
      }
    });
  }

  test("vLLM on ROCm without docker GPU passthrough is refused", () => {
    const support = engineSpec("vllm").supports(host({ accelerator: "rocm", dockerGpu: false }));
    expect(support.ok).toBe(false);
  });

  test("MLX never offers docker — macOS has no Metal passthrough", () => {
    const support = engineSpec("mlx").supports(
      host({ platform: "darwin", arch: "arm64", accelerator: "metal", dockerGpu: true }),
    );
    expect(support.ok && support.runtimes).toEqual(["process"]);
  });

  test("Windows keeps llama.cpp native and offers vLLM and SGLang only through WSL2", () => {
    const windows = host({ platform: "win32", accelerator: "cuda", dockerGpu: true, wsl: true });
    expect(availableEngines(windows).filter((entry) => entry.support.ok).map((entry) => entry.id)).toEqual([
      "vllm",
      "sglang",
      "llamacpp",
    ]);
    expect(engineSpec("llamacpp").supports(windows)).toEqual({ ok: true, runtimes: ["process"] });
    expect(engineSpec("vllm").supports(windows)).toEqual({ ok: true, runtimes: ["wsl2"] });
    expect(engineSpec("sglang").supports(windows)).toEqual({ ok: true, runtimes: ["wsl2"] });
  });
});

describe("DGX Spark", () => {
  const spark = host({ platform: "linux", arch: "arm64", accelerator: "cuda", unifiedMemory: true });

  test("is not a special case — CUDA engines run natively", () => {
    expect(engineSpec("vllm").supports(spark).ok).toBe(true);
    expect(engineSpec("llamacpp").supports(spark).ok).toBe(true);
    expect(planLaunch(request({ host: spark })).env["CUDA_VISIBLE_DEVICES"]).toBe("GPU-aaa,GPU-bbb");
  });
});
