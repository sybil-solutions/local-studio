import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { ConnectorConfig } from "../src/connector-contract";
import { connectMcp } from "../src/mcp-client";
import { pluginArtifactDigest } from "../src/plugin-artifact-digest";
import { resolvePluginExecutable, validatePluginExecutable } from "../src/plugin-executable";
import { stageDesktopRuntime } from "../../../frontend/scripts/stage-desktop-runtime.mjs";

const roots: string[] = [];
const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const previousNodeRuntime = process.env.LOCAL_STUDIO_NODE_RUNTIME;
const previousRuntimeManifest = process.env.LOCAL_STUDIO_NODE_RUNTIME_MANIFEST;
const serverSource = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    const request = JSON.parse(line);
    if (typeof request.id !== "number") continue;
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "reviewed", version: "1.0.0" } }
      : request.method === "tools/list"
        ? { tools: [{ name: "observe", inputSchema: { type: "object" } }] }
        : { content: [{ type: "text", text: process.env.CONNECTOR_TOKEN ?? "reviewed" }] };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
`;

async function executableFixture(environment?: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-executable-"));
  roots.push(root);
  process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
  const artifactRoot = path.join(root, "artifact");
  const firstBin = path.join(root, "first-bin");
  const secondBin = path.join(root, "second-bin");
  const script = path.join(artifactRoot, "server.mjs");
  const runtimeName = path.basename(process.execPath);
  const firstRuntime = path.join(firstBin, runtimeName);
  await Promise.all([mkdir(artifactRoot, { recursive: true }), mkdir(firstBin), mkdir(secondBin)]);
  await Promise.all([
    copyFile(process.execPath, firstRuntime),
    copyFile(process.execPath, path.join(secondBin, runtimeName)),
    writeFile(script, serverSource),
  ]);
  await Promise.all([chmod(firstRuntime, 0o755), chmod(path.join(secondBin, runtimeName), 0o755)]);
  const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
  const resolved = await Effect.runPromise(
    resolvePluginExecutable({
      command: firstRuntime,
      args: [script],
      env: environment,
      cwd: artifactRoot,
      artifactRoot,
      artifactDigest,
    }),
  );
  const connector: ConnectorConfig = {
    id: "plugin-fixture-runtime",
    name: "Fixture runtime",
    transport: "stdio",
    command: resolved.command,
    args: resolved.args,
    env: environment,
    cwd: resolved.cwd,
    allowTools: ["observe"],
    permissionReviewed: true,
    origin: {
      kind: "plugin",
      id: "fixture",
      version: "1.0.0",
      binding: "runtime",
      artifactDigest,
      inventoryDigest: "sha256:inventory",
      executable: resolved.binding,
    },
    enabled: true,
  };
  return { connector, firstBin, firstRuntime, secondBin, script };
}

async function makeWritable(entry: string): Promise<void> {
  const stat = await lstat(entry);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await chmod(entry, 0o700);
    for (const name of await readdir(entry)) await makeWritable(path.join(entry, name));
    return;
  }
  if (stat.isFile()) await chmod(entry, 0o600);
}

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  if (previousNodeRuntime === undefined) delete process.env.LOCAL_STUDIO_NODE_RUNTIME;
  else process.env.LOCAL_STUDIO_NODE_RUNTIME = previousNodeRuntime;
  if (previousRuntimeManifest === undefined) {
    delete process.env.LOCAL_STUDIO_NODE_RUNTIME_MANIFEST;
  } else {
    process.env.LOCAL_STUDIO_NODE_RUNTIME_MANIFEST = previousRuntimeManifest;
  }
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await makeWritable(root);
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("plugin executable identity", () => {
  test("pins a bare command and rejects a later PATH resolution change", async () => {
    const { connector, secondBin } = await executableFixture();
    await expect(
      Effect.runPromise(validatePluginExecutable({ ...connector, env: { PATH: secondBin } })),
    ).rejects.toThrow("Plugin executable identity changed");
  });

  test("rejects an external executable byte change", async () => {
    const { connector, firstRuntime } = await executableFixture();
    await writeFile(firstRuntime, "changed-runtime");
    await chmod(firstRuntime, 0o755);
    await expect(Effect.runPromise(validatePluginExecutable(connector))).rejects.toThrow(
      "Plugin executable identity changed",
    );
  });

  test("rejects an executable script byte change", async () => {
    const { connector, script } = await executableFixture();
    await writeFile(script, "export const value = 'changed';\n");
    await expect(Effect.runPromise(validatePluginExecutable(connector))).rejects.toThrow(
      "Plugin executable identity changed",
    );
  });

  test("executes reviewed snapshot bytes after the source command is replaced", async () => {
    const { connector, firstRuntime } = await executableFixture();
    await Effect.runPromise(validatePluginExecutable(connector));
    await writeFile(firstRuntime, "replaced-after-validation");
    await chmod(firstRuntime, 0o755);
    const connection = connectMcp({
      transport: "stdio",
      command: connector.command ?? "",
      args: connector.args,
      startupEnvironment: connector.env ?? {},
      cwd: connector.cwd,
    });
    try {
      expect(await connection.listTools()).toEqual([
        { name: "observe", inputSchema: { type: "object" } },
      ]);
      expect(await connection.callTool("observe", {})).toEqual({
        content: [{ type: "text", text: "reviewed" }],
      });
    } finally {
      await connection.close();
    }
  });

  test("uses the separately bundled Node runtime as the complete trusted launcher", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-packaged-node-runtime-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const trustedRuntime = path.join(root, "desktop-runtime", "node");
    await Promise.all([
      mkdir(artifactRoot),
      mkdir(path.dirname(trustedRuntime), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(script, serverSource),
      copyFile(process.execPath, trustedRuntime),
    ]);
    await chmod(trustedRuntime, 0o755);
    process.env.LOCAL_STUDIO_NODE_RUNTIME = trustedRuntime;
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const resolved = await Effect.runPromise(
      resolvePluginExecutable({
        command: "node",
        args: [script],
        cwd: artifactRoot,
        artifactRoot,
        artifactDigest,
      }),
    );
    expect(resolved.binding.resolvedCommand).toBe(await realpath(trustedRuntime));
    const connection = connectMcp({
      transport: "stdio",
      command: resolved.command,
      args: resolved.args,
      startupEnvironment: {},
      cwd: resolved.cwd,
    });
    try {
      expect(await connection.listTools()).toEqual([
        { name: "observe", inputSchema: { type: "object" } },
      ]);
    } finally {
      await connection.close();
    }
  });

  test("rejects every unclassified argument after the pinned entrypoint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-argv-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const dangerousArguments = [
      "/tmp/payload",
      "config.json",
      "--config=/tmp/payload",
      "nested/config.json",
      "nested\\config.json",
      "C:\\payload\\config.json",
    ];
    for (const argument of dangerousArguments) {
      await expect(
        Effect.runPromise(
          resolvePluginExecutable({
            command: process.execPath,
            args: [script, argument],
            cwd: artifactRoot,
            artifactRoot,
            artifactDigest,
          }),
        ),
      ).rejects.toThrow("Plugin executable payload cannot be pinned");
    }
  });

  test("binds the audited runtime closure into connector approval identity", async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "local-studio-plugin-runtime-closure-")),
    );
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const runtimeDir = path.join(root, "runtime");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    await stageDesktopRuntime(
      { electronPlatformName: process.platform, arch: process.arch },
      { output: runtimeDir },
    );
    const runtime = path.join(runtimeDir, process.platform === "win32" ? "node.exe" : "node");
    process.env.LOCAL_STUDIO_NODE_RUNTIME = runtime;
    process.env.LOCAL_STUDIO_NODE_RUNTIME_MANIFEST = path.join(runtimeDir, "runtime-manifest.json");
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const resolved = await Effect.runPromise(
      resolvePluginExecutable({
        command: "node",
        args: [script],
        cwd: artifactRoot,
        artifactRoot,
        artifactDigest,
      }),
    );
    const connector: ConnectorConfig = {
      id: "plugin-runtime-closure",
      name: "Runtime closure",
      transport: "stdio",
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      allowTools: ["observe"],
      permissionReviewed: true,
      origin: {
        kind: "plugin",
        id: "fixture",
        version: "1.0.0",
        binding: "runtime",
        artifactDigest,
        inventoryDigest: "sha256:inventory",
        executable: resolved.binding,
      },
      enabled: true,
    };
    await expect(Effect.runPromise(validatePluginExecutable(connector))).resolves.toBeUndefined();
    if (process.platform === "darwin") {
      const before = createHash("sha256")
        .update(await readFile(runtime))
        .digest("hex");
      await chmod(runtime, 0o755);
      const result = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", runtime], {
        encoding: "utf8",
        maxBuffer: 16 * 1024,
        timeout: 10_000,
      });
      await chmod(runtime, 0o555);
      if (result.status !== 0) throw new Error("Ad-hoc runtime signing failed");
      const after = createHash("sha256")
        .update(await readFile(runtime))
        .digest("hex");
      expect(after).not.toBe(before);
      await expect(Effect.runPromise(validatePluginExecutable(connector))).resolves.toBeUndefined();
      const bytes = await readFile(runtime);
      bytes[0x4000] ^= 0xff;
      await chmod(runtime, 0o755);
      await writeFile(runtime, bytes);
      await chmod(runtime, 0o555);
      await expect(Effect.runPromise(validatePluginExecutable(connector))).rejects.toThrow(
        "Plugin executable identity changed",
      );
      return;
    }
    const license = path.join(runtimeDir, "LICENSE.node");
    await chmod(license, 0o600);
    await writeFile(license, "changed license closure");
    await expect(Effect.runPromise(validatePluginExecutable(connector))).rejects.toThrow(
      "Plugin executable identity changed",
    );
  });

  test("delivers declared connector data through the trusted bootstrap", async () => {
    const secret = "trusted-bootstrap-secret";
    const { connector } = await executableFixture({ CONNECTOR_TOKEN: secret });
    const connection = connectMcp({
      transport: "stdio",
      command: connector.command ?? "",
      args: connector.args,
      startupEnvironment: connector.env ?? {},
      cwd: connector.cwd,
    });
    try {
      expect(await connection.callTool("observe", {})).toEqual({
        content: [{ type: "text", text: secret }],
      });
    } finally {
      await connection.close();
    }
  });

  test("keeps snapshot resources non-executable and owner-only", async () => {
    const { connector } = await executableFixture();
    const binding = connector.origin?.executable;
    if (!binding) throw new Error("Executable binding is missing");
    const entries = await Promise.all([
      stat(path.dirname(binding.snapshotRoot)),
      stat(binding.snapshotRoot),
      stat(binding.snapshotCommand),
      stat(binding.files[0]?.snapshotArgument ?? ""),
      stat(binding.files[0]?.snapshotPath ?? ""),
    ]);
    expect(entries.map((entry) => entry.mode & 0o777)).toEqual([0o700, 0o500, 0o500, 0o400, 0o400]);
    const uid = process.geteuid?.();
    if (uid !== undefined) expect(entries.every((entry) => entry.uid === uid)).toBe(true);
  });

  test("rejects an escaping link before creating an executable snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-link-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const runtime = path.join(root, "runtime");
    const outside = path.join(root, "outside.mjs");
    await mkdir(artifactRoot);
    await copyFile(process.execPath, runtime);
    await chmod(runtime, 0o755);
    await writeFile(outside, serverSource);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await symlink(outside, path.join(artifactRoot, "server.mjs"));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: runtime,
          args: [path.join(artifactRoot, "server.mjs")],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("copies a contained link into the reviewed snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-contained-link-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const linkedScript = path.join(artifactRoot, "linked-server.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    await symlink("server.mjs", linkedScript);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const resolved = await Effect.runPromise(
      resolvePluginExecutable({
        command: process.execPath,
        args: [linkedScript],
        cwd: artifactRoot,
        artifactRoot,
        artifactDigest,
      }),
    );
    expect(resolved.args[0]).toBe(resolved.binding.files[0]?.snapshotArgument);
    expect(resolved.binding.files[0]?.snapshotPath.startsWith(resolved.binding.snapshotRoot)).toBe(
      true,
    );
    expect(resolved.args[0]?.startsWith(resolved.binding.snapshotRoot)).toBe(true);
  });

  test("rejects an artifact path replacement before snapshot creation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-replacement-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const replacement = path.join(root, "replacement.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    await writeFile(replacement, "throw new Error('replacement');\n");
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await rename(replacement, script);
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects a source path replacement during snapshot creation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-copy-race-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const replacement = path.join(root, "replacement.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    await writeFile(replacement, "throw new Error('replacement');\n");
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      resolvePluginExecutable(
        {
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        },
        {
          copyArtifact: async (source, target) => {
            await cp(source, target, {
              recursive: true,
              dereference: false,
              errorOnExist: true,
              force: false,
              preserveTimestamps: true,
              verbatimSymlinks: true,
            });
            renameSync(replacement, script);
          },
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects a launcher whose eventual executable payload cannot be pinned", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-launcher-"));
    roots.push(root);
    const artifactRoot = path.join(root, "artifact");
    await mkdir(artifactRoot);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: "npx",
          args: ["package-name"],
          env: { PATH: root },
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects an unknown launcher even when its bytes are locally available", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-unknown-launcher-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const runtime = path.join(root, "custom-runtime");
    await mkdir(artifactRoot);
    await Promise.all([writeFile(script, serverSource), copyFile(process.execPath, runtime)]);
    await chmod(runtime, 0o755);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: runtime,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects untrusted native bytes under a modeled launcher name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-fake-node-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const runtime = path.join(root, path.basename(process.execPath));
    await mkdir(artifactRoot);
    await Promise.all([writeFile(script, serverSource), writeFile(runtime, "untrusted runtime")]);
    await chmod(runtime, 0o755);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: runtime,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects an external classpath on an unmodeled Java launcher", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-classpath-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const runtime = path.join(root, "java");
    const classpath = path.join(root, "outside.jar");
    await mkdir(artifactRoot);
    await Promise.all([
      writeFile(script, serverSource),
      writeFile(classpath, "external bytecode"),
      copyFile(process.execPath, runtime),
    ]);
    await chmod(runtime, 0o755);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: runtime,
          args: [script],
          env: { CLASSPATH: classpath },
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects loader controls instead of treating them as connector data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-loader-env-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const loader = path.join(root, "outside-loader.so");
    await mkdir(artifactRoot);
    await Promise.all([writeFile(script, serverSource), writeFile(loader, "external loader")]);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: process.execPath,
          args: [script],
          env: { LD_AUDIT: loader },
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects a symlinked private snapshot base", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-link-"));
    roots.push(root);
    const dataDir = path.join(root, "data");
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const outside = path.join(root, "outside");
    await Promise.all([
      mkdir(artifactRoot),
      mkdir(path.join(dataDir, "runtime"), { recursive: true }),
      mkdir(outside),
    ]);
    await Promise.all([
      writeFile(script, serverSource),
      symlink(outside, path.join(dataDir, "runtime", "plugin-executables")),
    ]);
    await chmod(path.join(dataDir, "runtime"), 0o700);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects an existing snapshot base with non-private permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-mode-"));
    roots.push(root);
    const dataDir = path.join(root, "data");
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const base = path.join(dataDir, "runtime", "plugin-executables");
    await Promise.all([mkdir(artifactRoot), mkdir(base, { recursive: true })]);
    await Promise.all([writeFile(script, serverSource), chmod(base, 0o755)]);
    await chmod(path.join(dataDir, "runtime"), 0o700);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      Effect.runPromise(
        resolvePluginExecutable({
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        }),
      ),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects a Windows snapshot root with a permissive DACL", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-dacl-"));
    roots.push(root);
    const dataDir = path.join(root, "data");
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const base = path.join(dataDir, "runtime", "plugin-executables");
    await Promise.all([mkdir(artifactRoot), mkdir(base, { recursive: true })]);
    await writeFile(script, serverSource);
    await Promise.all([
      chmod(dataDir, 0o700),
      chmod(path.dirname(base), 0o700),
      chmod(base, 0o700),
    ]);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      resolvePluginExecutable(
        {
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        },
        {
          platform: "win32",
          windowsSecurity: {
            protect: async () => undefined,
            verify: async (entry) => {
              if (path.basename(entry) === "plugin-executables") {
                throw new Error("permissive DACL");
              }
            },
          },
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("rejects a Windows snapshot root with inherited ACL entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-inherited-"));
    roots.push(root);
    const dataDir = path.join(root, "data");
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const base = path.join(dataDir, "runtime", "plugin-executables");
    await Promise.all([mkdir(artifactRoot), mkdir(base, { recursive: true })]);
    await writeFile(script, serverSource);
    await Promise.all([
      chmod(dataDir, 0o700),
      chmod(path.dirname(base), 0o700),
      chmod(base, 0o700),
    ]);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      resolvePluginExecutable(
        {
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        },
        {
          platform: "win32",
          windowsSecurity: {
            protect: async () => undefined,
            verify: async (entry) => {
              if (path.basename(entry) === "plugin-executables") {
                throw new Error("inherited ACL");
              }
            },
          },
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("uses private ACLs for staging and immutable ACLs for reviewed snapshots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-acl-profile-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const protectedEntries: Array<{ entry: string; access: string | undefined }> = [];
    const verifiedEntries: Array<{ entry: string; access: string | undefined }> = [];
    const resolved = await resolvePluginExecutable(
      {
        command: process.execPath,
        args: [script],
        cwd: artifactRoot,
        artifactRoot,
        artifactDigest,
      },
      {
        platform: "win32",
        trustedRuntime: process.execPath,
        windowsSecurity: {
          protect: async (entry, _kind, access) => {
            protectedEntries.push({ entry, access });
          },
          verify: async (entry, _kind, access) => {
            verifiedEntries.push({ entry, access });
          },
        },
      },
    ).pipe(Effect.runPromise);
    expect(
      protectedEntries.some(
        ({ entry, access }) =>
          entry === path.dirname(resolved.binding.snapshotRoot) && access === "private",
      ),
    ).toBe(true);
    expect(
      verifiedEntries.some(
        ({ entry, access }) => entry === resolved.binding.snapshotRoot && access === "snapshot",
      ),
    ).toBe(true);
  });

  test("rejects a reviewed Windows snapshot after its immutable DACL changes", async () => {
    const { connector } = await executableFixture();
    const snapshotRoot = connector.origin?.executable?.snapshotRoot;
    if (!snapshotRoot) throw new Error("Executable binding is missing");
    await expect(
      validatePluginExecutable(connector, {
        platform: "win32",
        trustedRuntime: process.execPath,
        windowsSecurity: {
          protect: async () => undefined,
          verify: async (entry, _kind, access) => {
            if (entry === snapshotRoot && access === "snapshot") {
              throw new Error("snapshot DACL changed");
            }
          },
        },
      }).pipe(Effect.runPromise),
    ).rejects.toThrow("Plugin executable identity changed");
  });

  test("rejects snapshot-base replacement during copy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-snapshot-race-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    await expect(
      resolvePluginExecutable(
        {
          command: process.execPath,
          args: [script],
          cwd: artifactRoot,
          artifactRoot,
          artifactDigest,
        },
        {
          copyArtifact: async (source, target) => {
            const base = path.dirname(path.dirname(target));
            const moved = `${base}-moved`;
            await rename(base, moved);
            await symlink(moved, base);
            await cp(source, target, {
              recursive: true,
              dereference: false,
              errorOnExist: true,
              force: false,
              preserveTimestamps: true,
              verbatimSymlinks: true,
            });
          },
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("Plugin executable payload cannot be pinned");
  });

  test("keeps connector data values out of executable snapshots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-secret-snapshot-"));
    roots.push(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.join(root, "data");
    const artifactRoot = path.join(root, "artifact");
    const script = path.join(artifactRoot, "server.mjs");
    const secret = "connector-secret-not-for-disk";
    await mkdir(artifactRoot);
    await writeFile(script, serverSource);
    const artifactDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const resolved = await Effect.runPromise(
      resolvePluginExecutable({
        command: process.execPath,
        args: [script],
        env: { CONNECTOR_TOKEN: secret },
        cwd: artifactRoot,
        artifactRoot,
        artifactDigest,
      }),
    );
    const files = await readdir(resolved.binding.snapshotRoot, { recursive: true });
    const contents = await Promise.all(
      files.map(async (entry) => {
        const absolute = path.join(resolved.binding.snapshotRoot, entry);
        return (await lstat(absolute)).isFile() ? readFile(absolute, "utf8").catch(() => "") : "";
      }),
    );
    expect(JSON.stringify(resolved.binding)).not.toContain(secret);
    expect(contents.join("\n")).not.toContain(secret);
  });
});
