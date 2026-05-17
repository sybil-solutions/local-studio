import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import {
  clearRuntimeTargetsForTests,
  getDefaultRuntimeTarget,
  getRuntimeTargets,
  selectRuntimeTarget,
} from "./runtime-targets";

const originalEnvironment = { ...process.env };
const temporaryRoots: string[] = [];

afterEach(() => {
  clearRuntimeTargetsForTests();
  process.env = { ...originalEnvironment };
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "vllm-studio-runtime-targets-"));
  temporaryRoots.push(root);
  process.env["VLLM_STUDIO_RUNTIME_SKIP_DOCKER"] = "1";
  process.env["VLLM_STUDIO_RUNTIME_SKIP_SYSTEM"] = "1";
  return root;
};

const writeExecutable = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

const createFakePython = (root: string, version: string): string => {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const python = join(bin, "python");
  writeExecutable(
    python,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.11.0"; exit 0; fi
if [ "$2" = "--version" ]; then echo "${version}"; exit 0; fi
if [ "$1" = "-c" ]; then
cat <<'JSON'
{"version":"${version}","python":"${python}"}
JSON
exit 0
fi
sleep 20
`
  );
  return python;
};

const configFor = (dataDirectory: string): Config =>
  ({
    data_dir: dataDirectory,
    db_path: join(dataDirectory, "controller.db"),
    host: "127.0.0.1",
    port: 8080,
    inference_port: 8000,
    models_dir: join(dataDirectory, "models"),
    strict_openai_models: false,
    providers: [],
  }) as Config;

describe("runtime targets", () => {
  it("lists separate venv versions for one backend", async () => {
    const root = temporaryRoot();
    const first = createFakePython(join(root, "venv-a"), "0.9.0");
    const second = createFakePython(join(root, "venv-b"), "1.0.0");
    process.env["VLLM_STUDIO_VLLM_UPGRADE_VERSION"] = "0.20.0";
    process.env["VLLM_STUDIO_VLLM_PYTHONS"] = `${first},${second}`;

    const targets = (await getRuntimeTargets(configFor(root))).filter(
      (target) =>
        target.backend === "vllm" && (target.pythonPath === first || target.pythonPath === second)
    );

    expect(targets.map((target) => target.version).sort()).toEqual(["0.9.0", "1.0.0"]);
    expect(new Set(targets.map((target) => target.pythonPath)).size).toBe(2);
    expect(targets[0]?.update).toMatchObject({
      targetVersion: "0.20.0",
      packageSpec: "vllm==0.20.0",
      restartRequired: true,
    });
  });

  it("uses controller-owned latest vLLM target instead of a stale default version", async () => {
    const root = temporaryRoot();
    const python = createFakePython(join(root, "venv"), "0.20.0");
    delete process.env["VLLM_STUDIO_VLLM_UPGRADE_VERSION"];
    process.env["VLLM_STUDIO_VLLM_PYTHONS"] = python;

    const target = (await getRuntimeTargets(configFor(root))).find(
      (candidate) => candidate.backend === "vllm" && candidate.pythonPath === python
    );

    expect(target?.version).toBe("0.20.0");
    expect(target?.update).toMatchObject({
      currentVersion: "0.20.0",
      targetVersion: "latest",
      packageSpec: "vllm",
      restartRequired: true,
    });
  });

  it("prefers the newest system vLLM binary over a stale default venv", async () => {
    const root = temporaryRoot();
    const stale = createFakePython(join(root, "stale"), "0.15.1");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeExecutable(
      join(bin, "python3"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.11.0"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"version":null,"python":"'"$0"'","error":"missing"}'; exit 0; fi
exit 1
`
    );
    const vllm = join(bin, "vllm");
    writeExecutable(
      vllm,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "0.20.0"; exit 0; fi
exit 1
`
    );
    process.env["PATH"] = `${bin}:${originalEnvironment["PATH"] ?? ""}`;
    process.env["VLLM_STUDIO_RUNTIME_SKIP_SYSTEM"] = "0";
    process.env["VLLM_STUDIO_VLLM_PYTHONS"] = stale;

    const target = await getDefaultRuntimeTarget(configFor(root), "vllm");

    expect(target?.binaryPath).toBe(vllm);
    expect(target?.version).toBe("0.20.0");
  });

  it("distinguishes Docker and venv targets", async () => {
    const root = temporaryRoot();
    const python = createFakePython(join(root, "venv"), "0.9.0");
    const dockerBin = join(root, "docker-bin");
    mkdirSync(dockerBin, { recursive: true });
    writeExecutable(
      join(dockerBin, "docker"),
      `#!/bin/sh
if [ "$1" = "images" ]; then echo "vllm/vllm-openai:latest"; exit 0; fi
if [ "$1" = "ps" ]; then exit 0; fi
exit 1
`
    );
    process.env["PATH"] = `${dockerBin}:${originalEnvironment["PATH"] ?? ""}`;
    process.env["VLLM_STUDIO_RUNTIME_SKIP_DOCKER"] = "0";
    process.env["VLLM_STUDIO_VLLM_PYTHONS"] = python;

    const targets = (await getRuntimeTargets(configFor(root))).filter(
      (target) => target.backend === "vllm"
    );

    expect(targets.some((target) => target.kind === "venv" && target.pythonPath === python)).toBe(
      true
    );
    expect(
      targets.some(
        (target) => target.kind === "docker" && target.dockerImage === "vllm/vllm-openai:latest"
      )
    ).toBe(true);
  });

  it("discovers configured DS4 server binaries", async () => {
    const root = temporaryRoot();
    const executable = join(root, "ds4-server");
    writeExecutable(
      executable,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "ds4-server version test"; exit 0; fi
if [ "$1" = "--help" ]; then echo "Usage: ds4-server"; exit 0; fi
exit 1
`
    );

    const targets = (await getRuntimeTargets({ ...configFor(root), ds4_bin: executable })).filter(
      (target) => target.backend === "ds4"
    );

    expect(targets.some((target) => target.binaryPath === executable && target.installed)).toBe(
      true
    );
  });

  it("marks the running target active even when another target is selected", async () => {
    const root = temporaryRoot();
    const configured = createFakePython(join(root, "configured"), "0.9.0");
    const running = createFakePython(join(root, "running"), "0.10.0");
    process.env["VLLM_STUDIO_VLLM_PYTHONS"] = configured;
    const child = Bun.spawn([running, "-m", "vllm.entrypoints.openai.api_server"]);
    try {
      const initialTargets = await getRuntimeTargets(configFor(root), {
        pid: child.pid,
        backend: "vllm",
        model_path: null,
        port: 8000,
        served_model_name: null,
      });
      const configuredTarget = initialTargets.find((target) => target.pythonPath === configured);
      expect(configuredTarget).toBeTruthy();
      if (configuredTarget) await selectRuntimeTarget(configFor(root), configuredTarget.id);

      const targets = await getRuntimeTargets(configFor(root), {
        pid: child.pid,
        backend: "vllm",
        model_path: null,
        port: 8000,
        served_model_name: null,
      });
      const runningTarget = targets.find((target) => target.pythonPath === running);
      expect(runningTarget?.active).toBe(true);
      expect(runningTarget?.source).toBe("running");
    } finally {
      child.kill();
      await child.exited.catch(() => undefined);
    }
  });
});
