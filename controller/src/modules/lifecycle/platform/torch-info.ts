import type { RuntimeTorchBuildInfo } from "../types";
import { runCommand } from "../../../core/command";

export const getTorchBuildInfo = (python: string): RuntimeTorchBuildInfo => {
  const result = runCommand(python, [
    "-c",
    "import json\ntry:\n import torch\n print(json.dumps({'torch_version': getattr(torch, '__version__', None), 'torch_cuda': getattr(getattr(torch, 'version', None), 'cuda', None), 'torch_hip': getattr(getattr(torch, 'version', None), 'hip', None)}))\nexcept Exception:\n print(json.dumps({'torch_version': None, 'torch_cuda': None, 'torch_hip': None}))",
  ]);

  if (result.status !== 0) {
    return { torch_version: null, torch_cuda: null, torch_hip: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as Partial<RuntimeTorchBuildInfo> | null;
    return {
      torch_version: parsed?.torch_version ?? null,
      torch_cuda: parsed?.torch_cuda ?? null,
      torch_hip: parsed?.torch_hip ?? null,
    };
  } catch {
    return { torch_version: null, torch_cuda: null, torch_hip: null };
  }
};
