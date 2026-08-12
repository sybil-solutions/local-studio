import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../src/config/env";
import {
  installWslManagedRuntime,
  readWslManagedRuntimeReceipt,
  uninstallWslManagedRuntime,
  wslManagedInstallArguments,
  wslManagedPackageSpec,
  wslManagedRuntimePaths,
  wslSglangKernelWheel,
  wslSglangTorchPackageSpecs,
} from "../src/modules/engines/wsl-managed-runtime";

describe("managed WSL2 runtimes", () => {
  test("derives isolated exact paths below a non-root Linux home", () => {
    expect(wslManagedRuntimePaths("/home/pipeline", "vllm", "nonce")).toEqual({
      root: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest",
      parent: "/home/pipeline/.local/share/local-studio/runtime/venvs",
      pythonRoot: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/python",
      venvRoot: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/venv",
      pythonPath:
        "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/venv/bin/python",
      packageBinaryPath:
        "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/venv/bin/vllm",
      binaryPath: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm",
      staging: "/home/pipeline/.local/share/local-studio/runtime/venvs/.vllm-install-nonce",
      backup: "/home/pipeline/.local/share/local-studio/runtime/venvs/.vllm-backup-nonce",
    });
    expect(() => wslManagedRuntimePaths("/", "sglang")).toThrow("Unsafe WSL home directory");
    expect(() => wslManagedRuntimePaths("relative", "sglang")).toThrow("Unsafe WSL home directory");
  });

  test("accepts versions but not arbitrary package specifications", () => {
    expect(wslManagedPackageSpec("vllm")).toBe("vllm");
    expect(wslManagedPackageSpec("sglang", "0.5.9.post2")).toBe("sglang==0.5.9.post2");
    expect(wslManagedPackageSpec("vllm", "vllm==0.19.1")).toBeNull();
    expect(wslManagedPackageSpec("vllm", "https://example.test/package.whl")).toBeNull();
  });

  test("keeps installer values in argv and selects CUDA wheels with uv", () => {
    expect(
      wslManagedInstallArguments(
        "uv",
        "/home/user/.local/bin/uv",
        "/home/user/venv/bin/python",
        "vllm==0.19.1",
      ),
    ).toEqual([
      "/home/user/.local/bin/uv",
      [
        "pip",
        "install",
        "--python",
        "/home/user/venv/bin/python",
        "--upgrade",
        "vllm==0.19.1",
        "--torch-backend=auto",
      ],
    ]);
    expect(
      wslManagedInstallArguments("pip", "/unused/uv", "/home/user/venv/bin/python", "sglang"),
    ).toEqual(["/home/user/venv/bin/python", ["-m", "pip", "install", "--upgrade", "sglang"]]);
    expect(
      wslSglangTorchPackageSpecs({
        torch: "2.9.1",
        torchvision: "0.24.1",
        torchaudio: "2.9.1",
      }),
    ).toEqual(["torch==2.9.1", "torchvision==0.24.1", "torchaudio==2.9.1"]);
    expect(
      wslSglangKernelWheel({
        version: "0.3.21",
        cuda: "13.0",
        architecture: "x86_64",
      }),
    ).toBe(
      "https://github.com/sgl-project/whl/releases/download/v0.3.21/sgl_kernel-0.3.21+cu130-cp310-abi3-manylinux2014_x86_64.whl",
    );
    expect(
      wslSglangKernelWheel({
        version: "0.3.21",
        cuda: "12.9",
        architecture: "x86_64",
      }),
    ).toBeNull();
  });

  test("installs transactionally and uninstalls only the receipt-backed managed path", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "local-studio-wsl-managed-"));
    const config = { data_dir: dataDirectory } as Config;
    const calls: string[][] = [];
    const result = (status = 0, stdout = "", stderr = "") => ({
      status,
      stdout,
      stderr,
      timedOut: false,
      signal: null,
    });
    const runner = (_distribution: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "/usr/bin/id") return Effect.succeed(result(0, "1000"));
      if (args[0] === "/usr/bin/getent") {
        return Effect.succeed(result(0, "user:x:1000:1000:User:/home/user:/bin/bash"));
      }
      if (args[0] === "/bin/sh" && args.at(-1) === "python3") {
        return Effect.succeed(result(0, "/usr/bin/python3"));
      }
      if (args[0] === "/bin/sh" && args.at(-1) === "uv") {
        return Effect.succeed(result(0, "/home/user/.local/bin/uv"));
      }
      if (args[0] === "/usr/bin/find") {
        const stagingRoot = args[1] ?? "";
        if (stagingRoot.includes("/nvidia/cu13/lib")) {
          return Effect.succeed(result(0, `${stagingRoot}/libcudart.so.13`));
        }
        return Effect.succeed(
          result(0, `${stagingRoot}/cpython-3.12.13-linux-x86_64-gnu/bin/python3.12`),
        );
      }
      if (args[1] === "-c") {
        const script = args[2] ?? "";
        if (script.includes("torch.version.cuda")) return Effect.succeed(result(0, "13.0"));
        if (script.includes("torchvision") && script.includes("torchaudio")) {
          return Effect.succeed(
            result(0, '{"torch":"2.9.1","torchvision":"0.24.1","torchaudio":"2.9.1"}'),
          );
        }
        if (script.includes("site.getsitepackages")) {
          const stagingPython = args[0] ?? "";
          return Effect.succeed(
            result(
              0,
              `${stagingPython.slice(0, stagingPython.indexOf("/bin/python"))}/lib/python3.12/site-packages/nvidia/cu13`,
            ),
          );
        }
        return Effect.succeed(result(0, '{"version":"0.19.1","cuda":true,"devices":2}'));
      }
      if (args[0] === "/usr/bin/test" && args[1] === "-e") {
        return Effect.succeed(result(1));
      }
      return Effect.succeed(result());
    };

    const install = await Effect.runPromise(
      installWslManagedRuntime({
        config,
        backend: "vllm",
        distribution: "Ubuntu",
        runner,
      }),
    );
    const receipt = readWslManagedRuntimeReceipt(config, "Ubuntu", "vllm");

    expect(install.success).toBe(true);
    expect(receipt?.version).toBe("0.19.1");
    expect(receipt?.root).toBe("/home/user/.local/share/local-studio/runtime/venvs/vllm-latest");
    expect(calls.some((args) => args.includes("--torch-backend=auto"))).toBe(true);
    expect(calls.some((args) => args.includes("--relocatable"))).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[0] === "/home/user/.local/bin/uv" &&
          args.slice(1, 4).join(" ") === "python install --no-bin" &&
          args.includes("--install-dir"),
      ),
    ).toBe(true);
    expect(calls.some((args) => args.includes("nvidia-cuda-nvcc==13.0.*"))).toBe(true);
    expect(calls.some((args) => args.includes("nvidia-cuda-crt==13.0.*"))).toBe(true);
    expect(calls.some((args) => args.includes("/usr/lib/wsl/lib/libcuda.so"))).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[0] === "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm" &&
          args[1] === "--help",
      ),
    ).toBe(true);

    const uninstall = await Effect.runPromise(
      uninstallWslManagedRuntime({
        config,
        backend: "vllm",
        distribution: "Ubuntu",
        runner,
      }),
    );
    const remove = calls.find(
      (args) => args[0] === "/bin/rm" && args.includes(receipt?.root ?? "missing"),
    );

    expect(uninstall.success).toBe(true);
    expect(remove).toEqual([
      "/bin/rm",
      "-rf",
      "--",
      "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest",
    ]);
    expect(readWslManagedRuntimeReceipt(config, "Ubuntu", "vllm")).toBeNull();
    expect(calls.flat()).not.toContain("--terminate");
    expect(calls.flat()).not.toContain("--shutdown");
    rmSync(dataDirectory, { recursive: true, force: true });
  });
});
