import type { Backend } from "@local-studio/contracts/recipes";
import {
  realProcessPlatform,
  splitProcessCommandLine,
  type ProcessPlatform,
} from "../../../core/process-platform";
import { hasCliServeInvocation, hasModuleInvocation } from "../argument-utilities";

/**
 * Discovery of manually-started engines: one `ps` sweep plus argv fingerprints. This is
 * how a hand-launched `llama-server` or `vllm serve` shows up as a runtime target even
 * though the controller did not start it. Read-only — nothing here ever signals a pid.
 */

export interface ScannedProcess {
  readonly pid: number;
  readonly args: string[];
}

export const listProcesses = (
  processPlatform: ProcessPlatform = realProcessPlatform,
): ScannedProcess[] => {
  try {
    return processPlatform.list().flatMap((entry) => {
      const args = splitProcessCommandLine(entry.commandLine);
      return args.length > 0 ? [{ pid: entry.pid, args }] : [];
    });
  } catch {
    return [];
  }
};

export const detectBackend = (args: string[]): Backend | null => {
  if (args.length === 0) return null;
  if (hasModuleInvocation(args, "vllm.entrypoints.openai.api_server")) return "vllm";
  if (hasCliServeInvocation(args, "vllm")) return "vllm";
  if (hasModuleInvocation(args, "sglang.launch_server")) return "sglang";
  if (hasCliServeInvocation(args, "sglang")) return "sglang";
  if (args.some((argument) => argument.includes("llama-server"))) return "llamacpp";
  if (hasModuleInvocation(args, "mlx_lm.server")) return "mlx";
  if (args.some((argument) => argument.includes("mlx_lm.server"))) return "mlx";
  return null;
};
