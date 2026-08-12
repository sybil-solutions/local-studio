import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runtimeTargetsForWslDistributions } from "../src/modules/engines/runtimes/runtime-targets";
import { wslManagedRuntimeReceiptPath } from "../src/modules/engines/wsl-managed-runtime";

describe("WSL2 runtime targets", () => {
  test("offers uninstalled vLLM and SGLang targets without probing WSL", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "local-studio-wsl-targets-"));
    const targets = runtimeTargetsForWslDistributions(
      { data_dir: dataDirectory },
      [
        { name: "Ubuntu", version: 2, default: true },
        { name: "Debian Dev", version: 2, default: false },
      ],
    );

    expect(targets).toHaveLength(4);
    expect(new Set(targets.map((target) => target.backend))).toEqual(new Set(["vllm", "sglang"]));
    expect(targets.every((target) => target.kind === "wsl2")).toBe(true);
    expect(targets.every((target) => !target.installed)).toBe(true);
    expect(targets.every((target) => target.version === null)).toBe(true);
    expect(targets.every((target) => target.health.status === "warning")).toBe(true);
    expect(targets.every((target) => target.capabilities.canInstall)).toBe(true);
    expect(targets.every((target) => !target.capabilities.canLaunch)).toBe(true);
    expect(targets.slice(0, 2).every((target) => target.wslDefault)).toBe(true);
    expect(targets.find((target) => target.backend === "vllm")?.binaryPath).toBe(
      "~/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm",
    );
    expect(targets.map((target) => target.wslDistribution)).toEqual([
      "Ubuntu",
      "Ubuntu",
      "Debian Dev",
      "Debian Dev",
    ]);
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  test("hydrates managed state from a controller receipt without starting WSL", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "local-studio-wsl-receipt-"));
    const receiptPath = wslManagedRuntimeReceiptPath(
      { data_dir: dataDirectory },
      "Ubuntu",
      "vllm",
    );
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(
      receiptPath,
      JSON.stringify({
        schemaVersion: 1,
        backend: "vllm",
        distribution: "Ubuntu",
        root: "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest",
        pythonPath:
          "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest/venv/bin/python",
        binaryPath: "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm",
        version: "0.19.1",
        installedAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    const targets = runtimeTargetsForWslDistributions(
      { data_dir: dataDirectory },
      [{ name: "Ubuntu", version: 2, default: true }],
    );
    const vllm = targets.find((target) => target.backend === "vllm");

    expect(vllm?.installed).toBe(true);
    expect(vllm?.version).toBe("0.19.1");
    expect(vllm?.capabilities.canLaunch).toBe(true);
    expect(vllm?.capabilities.canUpdate).toBe(true);
    expect(vllm?.capabilities.canUninstall).toBe(true);
    expect(targets.find((target) => target.backend === "sglang")?.installed).toBe(false);
    rmSync(dataDirectory, { recursive: true, force: true });
  });
});
