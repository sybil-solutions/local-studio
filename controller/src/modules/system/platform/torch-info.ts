import type { RuntimeTorchBuildInfo } from "../../models/types";
import type { CommandResult } from "../../../core/command";
import { runCommandAsync } from "../../../core/command";

// `import torch` can take several seconds. This kept the whole event loop frozen
// when run synchronously; the async variant lets it run off the event loop.
const TORCH_PROBE_TIMEOUT_MS = 3_000;
const TORCH_PROBE_ARGS = [
  "-c",
  "import json\ntry:\n import torch\n print(json.dumps({'torch_version': getattr(torch, '__version__', None), 'torch_cuda': getattr(getattr(torch, 'version', None), 'cuda', None), 'torch_hip': getattr(getattr(torch, 'version', None), 'hip', None)}))\nexcept Exception:\n print(json.dumps({'torch_version': None, 'torch_cuda': None, 'torch_hip': None}))",
];

const EMPTY_TORCH: RuntimeTorchBuildInfo = {
  torch_version: null,
  torch_cuda: null,
  torch_hip: null,
};

const parseTorchBuildOutput = (result: Pick<CommandResult, "status" | "stdout">): RuntimeTorchBuildInfo => {
  if (result.status !== 0) return { ...EMPTY_TORCH };
  try {
    const parsed = JSON.parse(result.stdout) as Partial<RuntimeTorchBuildInfo> | null;
    return {
      torch_version: parsed?.torch_version ?? null,
      torch_cuda: parsed?.torch_cuda ?? null,
      torch_hip: parsed?.torch_hip ?? null,
    };
  } catch {
    return { ...EMPTY_TORCH };
  }
};

export const getTorchBuildInfoAsync = async (python: string): Promise<RuntimeTorchBuildInfo> =>
  parseTorchBuildOutput(
    await runCommandAsync(python, TORCH_PROBE_ARGS, { timeoutMs: TORCH_PROBE_TIMEOUT_MS }),
  );
