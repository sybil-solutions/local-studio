import type { ComputeEngineSpec, EngineSupport, HostProfile } from "../contracts";
import {
  health,
  plan,
  prometheusMetrics,
  serverArguments,
  supported,
  unsupported,
  type Spelling,
} from "./shared";

// vLLM compiles CUDA graphs on a cold start; a large MoE's first launch is the worst case
// observed, and a warm start beats it by two orders of magnitude.
const READY_DEADLINE_MS = 1_800_000;

const spelling: Spelling = {
  tensorParallel: { flag: "--tensor-parallel-size" },
  pipelineParallel: { flag: "--pipeline-parallel-size" },
  maxContextLength: { flag: "--max-model-len" },
  memoryFraction: { flag: "--gpu-memory-utilization" },
  maxConcurrentRequests: { flag: "--max-num-seqs" },
  kvCacheDtype: { flag: "--kv-cache-dtype" },
  dtype: { flag: "--dtype" },
  quantization: { flag: "--quantization" },
  trustRemoteCode: { flag: "--trust-remote-code" },
  toolCallParser: { flag: "--tool-call-parser", companion: "--enable-auto-tool-choice" },
  reasoningParser: { flag: "--reasoning-parser" },
};

const image = (host: HostProfile): string | null => {
  if (host.accelerator === "rocm") return "rocm/vllm:latest";
  if (host.accelerator === "cuda") return "vllm/vllm-openai:latest";
  return null;
};

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") {
    return unsupported("vLLM has no Metal backend — use llamacpp or mlx on Apple Silicon");
  }
  if (host.platform === "win32") {
    if (!host.wsl) return unsupported("vLLM requires an explicit WSL2 or remote Linux runtime");
    if (host.accelerator !== "cuda") {
      return unsupported(`vLLM in WSL2 needs a CUDA device; this host reports ${host.accelerator}`);
    }
    return supported("wsl2");
  }
  if (host.accelerator === "rocm") {
    // Upstream publishes ROCm images; the PyPI wheels are CUDA-only.
    return host.dockerGpu
      ? supported("docker")
      : unsupported("vLLM on ROCm needs Docker with GPU passthrough (rocm/vllm)");
  }
  if (host.accelerator !== "cuda") {
    return unsupported(`vLLM needs a CUDA or ROCm device; this host reports ${host.accelerator}`);
  }
  return host.dockerGpu ? supported("process", "docker") : supported("process");
};

export const vllm: ComputeEngineSpec = {
  id: "vllm",
  defaultBinary: "vllm",
  defaultPort: 8000,
  health: health("/health", READY_DEADLINE_MS),
  metrics: prometheusMetrics("vllm", "kv_cache_usage_perc"),
  image,
  supports,
  plan: (request) =>
    plan(request, {
      // `vllm serve <path>` takes the model positionally.
      args: serverArguments(
        request,
        {
          subcommand: request.runtime === "docker" ? [] : ["serve"],
          modelFlag: null,
          servedNameFlag: "--served-model-name",
          spelling,
        },
        request.port,
      ),
      health: health("/health", READY_DEADLINE_MS),
      listenPort: request.port,
      image: image(request.host),
      ...(request.runtime === "wsl2"
        ? {
            env: {
              VLLM_USE_V2_MODEL_RUNNER: request.env["VLLM_USE_V2_MODEL_RUNNER"] ?? "0",
            },
          }
        : {}),
    }),
};
