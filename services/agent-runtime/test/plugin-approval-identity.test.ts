import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { ConnectorConfig } from "../src/connector-contract";
import { callConnectorTool, probePersistedConnector } from "../src/connector-pool";
import { closePooledConnection, getOrCreatePooledConnection } from "../src/connector-pool-state";
import {
  listConnectors,
  removeConnector,
  saveConnectors,
  saveConnectorsEffect,
  toConnectorView,
} from "../src/connectors-service";
import {
  googleAuthorizationHeaders,
  saveGoogleClient,
  type GoogleOAuthDependencies,
} from "../src/google-account";
import { GOOGLE_WORKSPACE_BINDINGS } from "../src/google-workspace-binding";
import { stdioChildEnvironment } from "../src/mcp-client";
import type { OAuthVault } from "../src/oauth-vault";
import { pluginConnectorConfigurationDigest } from "../src/plugin-connector-identity";
import {
  discoverPluginBundles,
  type PluginBundle,
  type PluginSource,
} from "../src/plugin-discovery";
import {
  garbageCollectPluginExecutionSnapshots,
  preparePluginExecutionSnapshot,
  quarantinePluginExecutionSnapshot,
  verifyPluginExecutionSnapshot,
  withPluginExecutionSnapshotLifecycle,
} from "../src/plugin-execution-snapshot";
import { refreshEnabledPluginConnectors, setPluginEnabled } from "../src/plugin-runtime";

const originalDataDirectory = process.env.LOCAL_STUDIO_DATA_DIR;
const roots: string[] = [];

function restoreWritable(entryPath: string): void {
  if (!existsSync(entryPath)) return;
  const stats = lstatSync(entryPath);
  if (stats.isSymbolicLink()) return;
  if (stats.isDirectory()) {
    chmodSync(entryPath, 0o700);
    readdirSync(entryPath).forEach((name) => restoreWritable(path.join(entryPath, name)));
  } else {
    chmodSync(entryPath, 0o600);
  }
}

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDirectory;
  for (const root of roots.splice(0)) {
    restoreWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): { root: string; source: PluginSource[] } {
  const parent = mkdtempSync(path.join(tmpdir(), "local-studio-plugin-approval-"));
  roots.push(parent);
  process.env.LOCAL_STUDIO_DATA_DIR = path.join(parent, "data");
  const root = path.join(parent, "fixture");
  mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  writeFileSync(path.join(root, "server.js"), "process.exit(1)");
  writeFileSync(path.join(root, "artifact.txt"), "artifact-one");
  writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      mcpServers: "mcp.json",
    }),
  );
  writeFileSync(
    path.join(root, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: ["./server.js"],
          env: { EXPLICIT: "one" },
          cwd: ".",
        },
      },
    }),
  );
  return { root, source: [{ label: "Fixture", dir: root, priority: 1 }] };
}

async function approvedConnector(root: string, source: PluginSource[]): Promise<ConnectorConfig> {
  const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
  if (!bundle) throw new Error("fixture plugin was not discovered");
  const connector: ConnectorConfig = {
    id: "plugin-fixture-fixture",
    name: "fixture",
    transport: "stdio",
    command: process.execPath,
    args: [realpathSync(path.join(root, "server.js"))],
    env: { EXPLICIT: "one" },
    cwd: realpathSync(root),
    allowTools: ["read"],
    enabled: true,
  };
  return {
    ...connector,
    origin: {
      kind: "plugin",
      id: "fixture",
      version: "1.0.0",
      binding: "fixture",
      artifactDigest: bundle.artifactDigest,
      sourceDigest: bundle.sourceDigest,
      configurationDigest: pluginConnectorConfigurationDigest(connector),
    },
  };
}

async function prepareSnapshot(
  root: string,
  source: PluginSource[],
  connector?: ConnectorConfig,
): Promise<ConnectorConfig> {
  const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
  if (!bundle) throw new Error("fixture plugin was not discovered");
  const target = connector ?? (await approvedConnector(root, source));
  return prepareConnectorSnapshot(bundle, target);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function prepareConnectorSnapshot(
  bundle: PluginBundle,
  connector: ConnectorConfig,
): Promise<ConnectorConfig> {
  return Effect.runPromise(
    withPluginExecutionSnapshotLifecycle((lifecycle) =>
      preparePluginExecutionSnapshot(bundle, connector, lifecycle),
    ),
  );
}

function executionRoot(): string {
  const data = process.env.LOCAL_STUDIO_DATA_DIR;
  if (!data) throw new Error("fixture data directory is missing");
  return path.join(data, "runtime", "plugin-executables");
}

function snapshotRoot(connector: ConnectorConfig): string {
  const digest = connector.origin?.artifactDigest;
  if (!digest) throw new Error("connector artifact digest is missing");
  return path.join(executionRoot(), digest.replace("sha256:", ""));
}

function writeProbeServer(root: string, marker: string): void {
  writeFileSync(
    path.join(root, "server.js"),
    `const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync(${JSON.stringify(marker)}, "launched");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } }) + "\\n");
  if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\\n");
});`,
  );
}

describe("plugin approval identity", () => {
  test("revokes approval after same-version artifact drift before a tool call", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([approved]);
    writeFileSync(path.join(root, "artifact.txt"), "artifact-two");
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    const [revoked] = await listConnectors();
    expect(revoked?.enabled).toBe(false);
    expect(revoked?.allowTools).toEqual([]);
    expect(revoked?.origin?.artifactDigest).not.toBe(approved.origin?.artifactDigest);
    await expect(callConnectorTool(approved.id, "read", {})).rejects.toThrow(/disabled/);
  });

  test("revokes approval after persisted configuration drift", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([{ ...approved, env: { EXPLICIT: "tampered" } }]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    const [revoked] = await listConnectors();
    expect(revoked?.enabled).toBe(false);
    expect(revoked?.allowTools).toEqual([]);
    expect(revoked?.env).toEqual({ EXPLICIT: "one" });
  });

  test("removes stale launch fields when the plugin transport changes", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([
      {
        ...approved,
        headers: { Authorization: "stale" },
        auth: { type: "oauth", provider: "fixture", account: "stale" },
      },
    ]);
    writeFileSync(
      path.join(root, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: {
            type: "http",
            url: "https://example.test/mcp",
          },
        },
      }),
    );
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    const [revoked] = await listConnectors();
    expect(revoked).toMatchObject({
      transport: "http",
      url: "https://example.test/mcp",
      allowTools: [],
      enabled: false,
    });
    expect(revoked?.command).toBeUndefined();
    expect(revoked?.args).toBeUndefined();
    expect(revoked?.env).toBeUndefined();
    expect(revoked?.cwd).toBeUndefined();
    expect(revoked?.headers).toEqual({});
    expect(revoked?.auth).toBeUndefined();
    expect(revoked?.origin?.configurationDigest).toBe(
      pluginConnectorConfigurationDigest(revoked as ConnectorConfig),
    );
  });

  test("fails closed for legacy approval and a removed plugin", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([
      {
        ...approved,
        origin: { kind: "plugin", id: "fixture", version: "1.0.0", binding: "fixture" },
      },
    ]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]?.enabled).toBe(false);
    await saveConnectors([approved]);
    rmSync(root, { recursive: true });
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]?.enabled).toBe(false);
  });

  test("revokes only the grant owned by an artifact that discovery can no longer read", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([approved]);
    symlinkSync("missing", path.join(root, "dangling"));
    await expect(Effect.runPromise(refreshEnabledPluginConnectors(source))).rejects.toThrow();
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
  });

  test("removes the granted record when its persisted connector id drifts", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([{ ...approved, id: "tampered" }]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    const connectors = await listConnectors();
    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toMatchObject({
      id: approved.id,
      enabled: false,
      allowTools: [],
    });
    await expect(callConnectorTool("tampered", "read", {})).rejects.toThrow(/Unknown/);
  });

  test("does not expose internal approval digests in connector views", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    const view = toConnectorView({
      ...approved,
      env: { LOW_ENTROPY_PASSWORD: "guessable" },
      headers: { Authorization: "Bearer private" },
    });
    expect(view.origin).toEqual({
      kind: "plugin",
      id: "fixture",
      version: "1.0.0",
      binding: "fixture",
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(approved.origin?.artifactDigest ?? "missing");
    expect(serialized).not.toContain(approved.origin?.configurationDigest ?? "missing");
    expect(serialized).not.toContain("guessable");
    expect(serialized).not.toContain("Bearer private");
  });

  test("binds every launch configuration field deterministically", () => {
    const base: ConnectorConfig = {
      id: "plugin-fixture-server",
      name: "Fixture",
      transport: "stdio",
      command: "/runtime/node",
      args: ["server.js"],
      env: { B: "two", A: "one" },
      cwd: "/plugin",
      url: "https://example.test/mcp",
      headers: { B: "two", A: "one" },
      auth: { type: "oauth", provider: "fixture", account: "one" },
      enabled: false,
    };
    const digest = pluginConnectorConfigurationDigest(base);
    expect(
      pluginConnectorConfigurationDigest({
        ...base,
        env: { A: "one", B: "two" },
        headers: { A: "one", B: "two" },
      }),
    ).toBe(digest);
    const changes: ConnectorConfig[] = [
      { ...base, id: "plugin-fixture-other" },
      { ...base, transport: "http" },
      { ...base, command: "/runtime/other" },
      { ...base, args: ["other.js"] },
      { ...base, env: { A: "changed" } },
      { ...base, cwd: "/other" },
      { ...base, url: "https://other.test/mcp" },
      { ...base, headers: { A: "changed" } },
      { ...base, auth: { type: "oauth", provider: "fixture", account: "two" } },
    ];
    changes.forEach((changed) =>
      expect(pluginConnectorConfigurationDigest(changed)).not.toBe(digest),
    );
  });

  test("rejects an interpreter entry point outside the plugin bundle", async () => {
    const { root, source } = fixture();
    const outside = path.join(path.dirname(root), "outside.js");
    writeFileSync(outside, "process.exit(0)");
    writeFileSync(
      path.join(root, "mcp.json"),
      JSON.stringify({
        mcpServers: { fixture: { command: process.execPath, args: [outside], cwd: "." } },
      }),
    );
    await expect(Effect.runPromise(setPluginEnabled("fixture", true, source))).rejects.toThrow(
      /escapes its bundle/,
    );
  });

  test("rejects plugin environment variables that load external code", async () => {
    const { root, source } = fixture();
    writeFileSync(
      path.join(root, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: ["./server.js"],
            env: { LD_AUDIT: "/tmp/external.so" },
            cwd: ".",
          },
        },
      }),
    );
    await expect(Effect.runPromise(setPluginEnabled("fixture", true, source))).rejects.toThrow(
      /may not load external code/,
    );
  });

  test("pins approved executable bytes in a hardened private snapshot", async () => {
    const { root, source } = fixture();
    chmodSync(path.join(root, "server.js"), 0o755);
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = await approvedConnector(root, source);
    const prepared = await prepareConnectorSnapshot(bundle, {
      ...connector,
      command: realpathSync(path.join(root, "server.js")),
      args: [],
    });
    expect(prepared.command).not.toBe(realpathSync(path.join(root, "server.js")));
    expect(readFileSync(prepared.command ?? "", "utf8")).toBe("process.exit(1)");
    writeFileSync(path.join(root, "server.js"), "process.exit(0)");
    await Effect.runPromise(verifyPluginExecutionSnapshot(prepared));
    expect(readFileSync(prepared.command ?? "", "utf8")).toBe("process.exit(1)");
    chmodSync(prepared.command ?? "", 0o700);
    await expect(Effect.runPromise(verifyPluginExecutionSnapshot(prepared))).rejects.toThrow(
      /writable/,
    );
  });

  test("reuses an unchanged retained snapshot without replacing its directory", async () => {
    const { root, source } = fixture();
    const connector = await approvedConnector(root, source);
    const prepared = await prepareSnapshot(root, source, connector);
    await saveConnectors([prepared]);
    const storageBefore = lstatSync(executionRoot());
    const snapshotBefore = lstatSync(snapshotRoot(prepared));
    const repeated = await prepareSnapshot(root, source, connector);
    const storageAfter = lstatSync(executionRoot());
    const snapshotAfter = lstatSync(snapshotRoot(repeated));
    expect({ dev: storageAfter.dev, ino: storageAfter.ino }).toEqual({
      dev: storageBefore.dev,
      ino: storageBefore.ino,
    });
    expect({ dev: snapshotAfter.dev, ino: snapshotAfter.ino }).toEqual({
      dev: snapshotBefore.dev,
      ino: snapshotBefore.ino,
    });
    expect(repeated.origin?.snapshotDigest).toBe(prepared.origin?.snapshotDigest);
    expect(readdirSync(executionRoot()).some((name) => name.startsWith(".garbage-"))).toBe(false);
  });

  test("does not replace a competing snapshot destination", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    mkdirSync(executionRoot(), { recursive: true, mode: 0o700 });
    const victim = path.join(path.dirname(root), "snapshot-victim");
    mkdirSync(victim, { mode: 0o700 });
    const marker = path.join(victim, "marker");
    writeFileSync(marker, "outside");
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    symlinkSync(victim, destination);
    await expect(
      prepareConnectorSnapshot(bundle, await approvedConnector(root, source)),
    ).rejects.toThrow();
    expect(lstatSync(destination).isSymbolicLink()).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe("outside");
  });

  test("does not delete a retained snapshot swapped into a failing publication", async () => {
    const { root, source } = fixture();
    const retained = await prepareSnapshot(root, source, await approvedConnector(root, source));
    await saveConnectors([retained]);
    const retainedPath = snapshotRoot(retained);
    writeFileSync(path.join(root, "artifact.txt"), "artifact-two");
    const [candidateBundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!candidateBundle) throw new Error("fixture plugin was not discovered");
    const candidatePath = path.join(
      executionRoot(),
      candidateBundle.artifactDigest.replace("sha256:", ""),
    );
    const racer = `const fs = require("node:fs");
const candidate = process.argv[1];
const retained = process.argv[2];
const deadline = Date.now() + 5000;
process.stdout.write("READY\\n");
while (Date.now() < deadline) {
  try {
    if (!fs.lstatSync(candidate).isDirectory()) continue;
    fs.renameSync(candidate, candidate + ".original-claim");
    fs.renameSync(retained, candidate);
    process.stdout.write("SWAPPED\\n");
    process.exit(0);
  } catch {}
}
process.stdout.write("TIMEOUT\\n");
process.exit(2);`;
    const child = Bun.spawn(["node", "-e", racer, candidatePath, retainedPath], {
      stdout: "pipe",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const waitForOutput = async (expected: string): Promise<void> => {
      while (!output.includes(expected)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Snapshot racer exited before ${expected}: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
      }
    };
    try {
      await waitForOutput("READY");
      const preparation = prepareConnectorSnapshot(
        candidateBundle,
        await approvedConnector(root, source),
      );
      await waitForOutput("SWAPPED");
      await expect(preparation).rejects.toThrow();
      expect(existsSync(retainedPath)).toBe(false);
      expect(readFileSync(path.join(candidatePath, "artifact", "artifact.txt"), "utf8")).toBe(
        "artifact-one",
      );
      expect(readdirSync(executionRoot()).some((name) => name.startsWith(".garbage-"))).toBe(false);
      const persisted = await listConnectors();
      await Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          garbageCollectPluginExecutionSnapshots(persisted, lifecycle),
        ),
      );
      expect(readFileSync(path.join(candidatePath, "artifact", "artifact.txt"), "utf8")).toBe(
        "artifact-one",
      );
      await removeConnector(retained.id);
      expect(existsSync(candidatePath)).toBe(false);
    } finally {
      child.kill();
      await child.exited;
      reader.releaseLock();
    }
  });

  test("preserves an unchanged approval only while its snapshot verifies", async () => {
    const { root, source } = fixture();
    chmodSync(path.join(root, "server.js"), 0o755);
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = await approvedConnector(root, source);
    const prepared = await prepareConnectorSnapshot(bundle, connector);
    await saveConnectors([prepared]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: true, allowTools: ["read"] });
  });

  test("revokes a host-runtime snapshot when its runtime identity is removed", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const prepared = await prepareConnectorSnapshot(bundle, await approvedConnector(root, source));
    if (!prepared.origin) throw new Error("prepared connector has no origin");
    const { runtimeDigest: _, ...origin } = prepared.origin;
    await saveConnectors([{ ...prepared, origin }]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
  });

  test("revokes a host-runtime snapshot whose persisted command path changes", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const prepared = await prepareConnectorSnapshot(bundle, await approvedConnector(root, source));
    const changed = { ...prepared, command: path.join(root, "server.js") };
    if (!changed.origin) throw new Error("prepared connector has no origin");
    await saveConnectors([
      {
        ...changed,
        origin: {
          ...changed.origin,
          configurationDigest: pluginConnectorConfigurationDigest(changed),
        },
      },
    ]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
  });

  test("revokes snapshot launch paths that escape the approved artifact", async () => {
    const { root, source } = fixture();
    chmodSync(path.join(root, "server.js"), 0o755);
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const approved = await approvedConnector(root, source);
    for (const prepared of [
      await prepareConnectorSnapshot(bundle, approved),
      await prepareConnectorSnapshot(bundle, {
        ...approved,
        command: realpathSync(path.join(root, "server.js")),
        args: [],
      }),
    ]) {
      const changed = prepared.origin?.runtimeDigest
        ? { ...prepared, args: [path.join(path.dirname(root), "outside.js")] }
        : { ...prepared, command: path.join(path.dirname(root), "outside.js") };
      if (!changed.origin) throw new Error("prepared connector has no origin");
      await saveConnectors([
        {
          ...changed,
          origin: {
            ...changed.origin,
            configurationDigest: pluginConnectorConfigurationDigest(changed),
          },
        },
      ]);
      await Effect.runPromise(refreshEnabledPluginConnectors(source));
      expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
    }
  });

  test("revokes a switch to a different entry inside the approved snapshot", async () => {
    const { root, source } = fixture();
    writeFileSync(path.join(root, "other.js"), "process.exit(0)");
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const prepared = await prepareConnectorSnapshot(bundle, await approvedConnector(root, source));
    const entry = prepared.args?.[0];
    if (!entry || !prepared.origin) throw new Error("prepared connector is incomplete");
    const changed = { ...prepared, args: [path.join(path.dirname(entry), "other.js")] };
    await saveConnectors([
      {
        ...changed,
        origin: {
          ...prepared.origin,
          configurationDigest: pluginConnectorConfigurationDigest(changed),
        },
      },
    ]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
  });

  test("refuses to snapshot bytes changed after discovery", async () => {
    const { root, source } = fixture();
    chmodSync(path.join(root, "server.js"), 0o755);
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = await approvedConnector(root, source);
    writeFileSync(path.join(root, "server.js"), "process.exit(0)");
    await expect(
      prepareConnectorSnapshot(bundle, {
        ...connector,
        command: realpathSync(path.join(root, "server.js")),
        args: [],
      }),
    ).rejects.toThrow(/changed while snapshotting/);
  });

  test("collects an obsolete snapshot after artifact drift and reapproval", async () => {
    const { root, source } = fixture();
    const first = await prepareSnapshot(root, source);
    await saveConnectors([first]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    const firstRoot = snapshotRoot(first);
    expect(existsSync(firstRoot)).toBe(true);
    writeFileSync(path.join(root, "artifact.txt"), "artifact-two");
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect(existsSync(firstRoot)).toBe(false);
    const second = await prepareSnapshot(root, source);
    await saveConnectors([second]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect(snapshotRoot(second)).not.toBe(firstRoot);
    expect(existsSync(snapshotRoot(second))).toBe(true);
  });

  test("collects a snapshot after its plugin is removed", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const retained = snapshotRoot(prepared);
    rmSync(root, { recursive: true });
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
    expect(existsSync(retained)).toBe(false);
  });

  test("collects a snapshot immediately after its connector is removed", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const retained = snapshotRoot(prepared);
    await removeConnector(prepared.id);
    expect(existsSync(retained)).toBe(false);
  });

  test("retains a shared snapshot until every approved grant is revoked", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    const disabledApproved = {
      ...prepared,
      id: "plugin-fixture-second",
      enabled: false,
      allowTools: ["read"],
    };
    await Effect.runPromise(
      withPluginExecutionSnapshotLifecycle((lifecycle) =>
        garbageCollectPluginExecutionSnapshots(
          [{ ...prepared, enabled: false, allowTools: [] }, disabledApproved],
          lifecycle,
        ),
      ),
    );
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
    await Effect.runPromise(
      withPluginExecutionSnapshotLifecycle((lifecycle) =>
        garbageCollectPluginExecutionSnapshots(
          [
            { ...prepared, enabled: false, allowTools: [] },
            { ...disabledApproved, allowTools: [] },
          ],
          lifecycle,
        ),
      ),
    );
    expect(existsSync(snapshotRoot(prepared))).toBe(false);
  });

  test("retains a snapshot while an approved plugin is disabled", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    await Effect.runPromise(setPluginEnabled("fixture", false, source));
    expect((await listConnectors())[0]).toMatchObject({
      enabled: false,
      allowTools: ["read"],
    });
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
  });

  test("removes stale snapshot temp roots", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const stale = `${snapshotRoot(prepared)}.tmp-stale`;
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, "partial"), "stale");
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
  });

  test("keeps a retained snapshot path stable while pooled shutdown precedes cleanup", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const retained = snapshotRoot(prepared);
    const stale = `${retained}.tmp-stale`;
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, "partial"), "stale");
    const closeStarted = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    await getOrCreatePooledConnection(prepared.id, async () => ({
      listTools: async () => [],
      callTool: async () => undefined,
      close: async () => {
        closeStarted.resolve();
        await allowClose.promise;
      },
    }));
    const cleanup = saveConnectors([prepared]);
    await closeStarted.promise;
    expect(existsSync(retained)).toBe(true);
    expect(existsSync(stale)).toBe(true);
    allowClose.resolve();
    await cleanup;
    expect(existsSync(retained)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  test("unlinks stale snapshot symlinks without touching their targets", async () => {
    const { root, source } = fixture();
    const outside = path.join(path.dirname(root), "outside-snapshot");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "marker"), "preserved");
    mkdirSync(executionRoot(), { recursive: true, mode: 0o700 });
    const staleLink = path.join(executionRoot(), "stale-link");
    const staleRoot = path.join(executionRoot(), "stale-root");
    mkdirSync(staleRoot);
    symlinkSync(outside, staleLink);
    symlinkSync(outside, path.join(staleRoot, "nested-link"));
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect(existsSync(staleLink)).toBe(false);
    expect(existsSync(staleRoot)).toBe(false);
    expect(readFileSync(path.join(outside, "marker"), "utf8")).toBe("preserved");
  });

  test("rejects a symlinked snapshot storage root without touching its target", async () => {
    const { source } = fixture();
    const outside = path.join(path.dirname(executionRoot()), "outside-storage-root");
    mkdirSync(outside, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(outside, "marker"), "preserved");
    mkdirSync(path.dirname(executionRoot()), { recursive: true, mode: 0o700 });
    symlinkSync(outside, executionRoot());
    await expect(Effect.runPromise(refreshEnabledPluginConnectors(source))).rejects.toThrow(
      /snapshot cleanup failed/,
    );
    expect(readFileSync(path.join(outside, "marker"), "utf8")).toBe("preserved");
  });

  test("rejects a symlinked snapshot storage ancestor for creation and cleanup", async () => {
    const { root, source } = fixture();
    const data = process.env.LOCAL_STUDIO_DATA_DIR;
    if (!data) throw new Error("fixture data directory is missing");
    const outside = path.join(path.dirname(data), "outside-runtime-root");
    mkdirSync(path.join(outside, "plugin-executables"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(outside, "marker"), "preserved");
    mkdirSync(data, { recursive: true, mode: 0o700 });
    symlinkSync(outside, path.join(data, "runtime"));
    await expect(prepareSnapshot(root, source)).rejects.toThrow(/snapshot/);
    await expect(Effect.runPromise(refreshEnabledPluginConnectors(source))).rejects.toThrow(
      /snapshot cleanup failed/,
    );
    expect(readFileSync(path.join(outside, "marker"), "utf8")).toBe("preserved");
  });

  test("cleans a quarantined snapshot identity after its original path is swapped", async () => {
    const { root, source } = fixture();
    const outside = path.join(path.dirname(root), "outside-quarantine");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "marker"), "preserved");
    mkdirSync(executionRoot(), { recursive: true, mode: 0o700 });
    const staleRoot = path.join(executionRoot(), "stale-root");
    mkdirSync(staleRoot);
    writeFileSync(path.join(staleRoot, "obsolete"), "obsolete");
    const quarantined = await quarantinePluginExecutionSnapshot(staleRoot);
    expect(quarantined).toBeDefined();
    symlinkSync(outside, staleRoot);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect(existsSync(staleRoot)).toBe(false);
    expect(quarantined ? existsSync(quarantined) : true).toBe(false);
    expect(readFileSync(path.join(outside, "marker"), "utf8")).toBe("preserved");
  });

  test("keeps atomic revoked state when snapshot cleanup fails", async () => {
    const { root, source } = fixture();
    const approved = await approvedConnector(root, source);
    await saveConnectors([approved]);
    mkdirSync(path.dirname(executionRoot()), { recursive: true });
    writeFileSync(executionRoot(), "not-a-directory");
    await expect(Effect.runPromise(refreshEnabledPluginConnectors(source))).rejects.toThrow(
      /snapshot cleanup failed/,
    );
    expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
    expect(
      JSON.parse(
        readFileSync(path.join(process.env.LOCAL_STUDIO_DATA_DIR ?? "", "connectors.json"), "utf8"),
      ),
    ).toBeDefined();
  });

  test("awaits pooled shutdown before snapshot cleanup", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const closeStarted = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    await getOrCreatePooledConnection(prepared.id, async () => ({
      listTools: async () => [],
      callTool: async () => undefined,
      close: async () => {
        closeStarted.resolve();
        await allowClose.promise;
      },
    }));
    restoreWritable(executionRoot());
    rmSync(executionRoot(), { recursive: true });
    writeFileSync(executionRoot(), "not-a-directory");
    let settled = false;
    const removal = removeConnector(prepared.id).finally(() => {
      settled = true;
    });
    await closeStarted.promise;
    expect(settled).toBe(false);
    expect(await listConnectors()).toEqual([]);
    allowClose.resolve();
    await expect(removal).rejects.toThrow(/snapshot cleanup failed/);
    expect(settled).toBe(true);
  });

  test("does not collect a snapshot when pooled shutdown fails", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const retained = snapshotRoot(prepared);
    let allowClose = false;
    await getOrCreatePooledConnection(prepared.id, async () => ({
      listTools: async () => [],
      callTool: async () => undefined,
      close: async () => {
        if (!allowClose) throw new Error("shutdown refused");
      },
    }));
    await expect(removeConnector(prepared.id)).rejects.toThrow(/Connector shutdown failed/);
    expect(await listConnectors()).toEqual([]);
    expect(existsSync(retained)).toBe(true);
    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          garbageCollectPluginExecutionSnapshots([], lifecycle),
        ),
      ),
    ).rejects.toThrow(/snapshot cleanup failed/);
    expect(existsSync(retained)).toBe(true);
    allowClose = true;
    await closePooledConnection(prepared.id);
    await Effect.runPromise(
      withPluginExecutionSnapshotLifecycle((lifecycle) =>
        garbageCollectPluginExecutionSnapshots([], lifecycle),
      ),
    );
    expect(existsSync(retained)).toBe(false);
  });

  test("interruption waits for connector mutation and snapshot cleanup before releasing its lease", async () => {
    const { root, source } = fixture();
    const prepared = await prepareSnapshot(root, source);
    await saveConnectors([prepared]);
    const closeStarted = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    await getOrCreatePooledConnection(prepared.id, async () => ({
      listTools: async () => [],
      callTool: async () => undefined,
      close: async () => {
        closeStarted.resolve();
        await allowClose.promise;
      },
    }));
    const controller = new AbortController();
    let mutationSettled = false;
    const mutation = Effect.runPromise(
      withPluginExecutionSnapshotLifecycle((lifecycle) => saveConnectorsEffect([], lifecycle)),
      { signal: controller.signal },
    ).finally(() => {
      mutationSettled = true;
    });
    await closeStarted.promise;
    controller.abort();
    let competitorAcquired = false;
    const competitor = Effect.runPromise(
      withPluginExecutionSnapshotLifecycle(() =>
        Effect.sync(() => {
          competitorAcquired = true;
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mutationSettled).toBe(false);
    expect(competitorAcquired).toBe(false);
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
    allowClose.resolve();
    await expect(mutation).rejects.toThrow();
    await competitor;
    expect(competitorAcquired).toBe(true);
    expect(existsSync(snapshotRoot(prepared))).toBe(false);
  });

  test("interrupting a plugin probe waits for stdio exit before snapshot cleanup", async () => {
    const { root, source } = fixture();
    const pidFile = path.join(path.dirname(root), "probe.pid");
    const readyFile = path.join(path.dirname(root), "probe.ready");
    writeFileSync(
      path.join(root, "server.js"),
      `const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync(process.env.PID_FILE, String(process.pid));
process.on("SIGTERM", () => undefined);
setInterval(() => undefined, 1000);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } }) + "\\n");
  if (request.method === "notifications/initialized") fs.writeFileSync(process.env.READY_FILE, "ready");
});`,
    );
    writeFileSync(
      path.join(root, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: ["./server.js"],
            env: { PID_FILE: pidFile, READY_FILE: readyFile },
            cwd: ".",
          },
        },
      }),
    );
    const controller = new AbortController();
    const activation = Effect.runPromise(setPluginEnabled("fixture", true, source), {
      signal: controller.signal,
    });
    await waitFor(() => existsSync(readyFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    const [snapshotName] = readdirSync(executionRoot());
    if (!snapshotName) throw new Error("Plugin snapshot was not created");
    const retained = path.join(executionRoot(), snapshotName);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(processIsAlive(pid)).toBe(true);
    expect(existsSync(retained)).toBe(true);
    await expect(activation).rejects.toThrow();
    await waitFor(() => !processIsAlive(pid));
    expect(existsSync(retained)).toBe(false);
  }, 10_000);

  test("does not launch a removed connector whose shared snapshot is retained", async () => {
    const { root, source } = fixture();
    const marker = path.join(path.dirname(root), "stale-probe-launched");
    writeProbeServer(root, marker);
    const approved = await approvedConnector(root, source);
    if (!approved.origin) throw new Error("approved connector has no origin");
    const first = await prepareSnapshot(root, source, {
      ...approved,
      id: "plugin-fixture-first",
      origin: { ...approved.origin, binding: "first" },
    });
    const second = await prepareSnapshot(root, source, {
      ...approved,
      id: "plugin-fixture-second",
      origin: { ...approved.origin, binding: "second" },
    });
    await saveConnectors([first, second]);
    await removeConnector(first.id);
    expect(existsSync(snapshotRoot(first))).toBe(true);
    expect((await listConnectors()).map(({ id }) => id)).toEqual([second.id]);
    await expect(probePersistedConnector(first.id)).rejects.toThrow(/Unknown connector/);
    expect(existsSync(marker)).toBe(false);
  });

  test("does not launch a persisted probe aborted while waiting for its lifecycle", async () => {
    const { root, source } = fixture();
    const marker = path.join(path.dirname(root), "cancelled-probe-launched");
    writeProbeServer(root, marker);
    const prepared = await prepareSnapshot(root, source, await approvedConnector(root, source));
    await saveConnectors([prepared]);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = Effect.runPromise(
      withPluginExecutionSnapshotLifecycle(() =>
        Effect.promise(() => {
          entered.resolve();
          return release.promise;
        }),
      ),
    );
    await entered.promise;
    const controller = new AbortController();
    const probe = probePersistedConnector(prepared.id, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(existsSync(marker)).toBe(false);
    release.resolve();
    await expect(probe).rejects.toThrow();
    await holder;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(marker)).toBe(false);
  });

  test("serializes persisted plugin probes with snapshot retirement", async () => {
    const { root, source } = fixture();
    const pidFile = path.join(path.dirname(root), "route-probe.pid");
    const readyFile = path.join(path.dirname(root), "route-probe.ready");
    writeFileSync(
      path.join(root, "server.js"),
      `const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync(process.env.PID_FILE, String(process.pid));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } }) + "\\n");
  if (request.method === "notifications/initialized") fs.writeFileSync(process.env.READY_FILE, "ready");
});`,
    );
    const approved = await approvedConnector(root, source);
    const prepared = await prepareSnapshot(root, source, {
      ...approved,
      env: { PID_FILE: pidFile, READY_FILE: readyFile },
    });
    await saveConnectors([prepared]);
    const controller = new AbortController();
    const probe = probePersistedConnector(prepared.id, controller.signal);
    await waitFor(() => existsSync(readyFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    let retired = false;
    const retirement = removeConnector(prepared.id).then(() => {
      retired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(retired).toBe(false);
    expect(processIsAlive(pid)).toBe(true);
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
    controller.abort();
    await expect(probe).rejects.toThrow();
    await retirement;
    await waitFor(() => !processIsAlive(pid));
    expect(existsSync(snapshotRoot(prepared))).toBe(false);
  });

  test("cleanup waits for a prepared snapshot to be persisted", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const approved = await approvedConnector(root, source);
    const preparedState = Promise.withResolvers<ConnectorConfig>();
    const persist = Promise.withResolvers<void>();
    const preparation = Effect.runPromise(
      withPluginExecutionSnapshotLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const prepared = yield* preparePluginExecutionSnapshot(bundle, approved, lifecycle);
          preparedState.resolve(prepared);
          yield* Effect.promise(() => persist.promise);
          yield* saveConnectorsEffect([prepared], lifecycle);
        }),
      ),
    );
    const prepared = await preparedState.promise;
    let cleanupFinished = false;
    const cleanup = Effect.runPromise(refreshEnabledPluginConnectors(source)).then(() => {
      cleanupFinished = true;
    });
    expect(await Promise.race([cleanup.then(() => true), Promise.resolve(false)])).toBe(false);
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
    persist.resolve();
    await Promise.all([preparation, cleanup]);
    expect(cleanupFinished).toBe(true);
    expect(existsSync(snapshotRoot(prepared))).toBe(true);
  });

  test("releases Google account mutation before disabling managed connectors", async () => {
    fixture();
    const values = new Map<string, string>();
    const vault: OAuthVault = {
      read: (key) => Effect.sync(() => values.get(key)),
      write: (key, value) => Effect.sync(() => void values.set(key, value)),
      remove: (key) => Effect.sync(() => void values.delete(key)),
    };
    const revokeStarted = Promise.withResolvers<void>();
    const revokeResponse = Promise.withResolvers<Response>();
    const dependencies: GoogleOAuthDependencies = {
      fetch: async () => {
        revokeStarted.resolve();
        return revokeResponse.promise;
      },
      now: () => 1_000,
      random: (size) => Buffer.alloc(size, 1),
      verifyAccess: async () => undefined,
    };
    const binding = GOOGLE_WORKSPACE_BINDINGS.gmail;
    const connector: ConnectorConfig = {
      id: binding.connectorId,
      name: binding.name,
      transport: "http",
      url: binding.endpoint,
      auth: { type: "oauth", provider: "google-workspace", account: "gmail" },
      allowTools: [...binding.observeTools],
      origin: { kind: "account-adapter", id: "gmail", binding: "google-workspace" },
      enabled: true,
    };
    await Effect.runPromise(
      saveGoogleClient({ clientId: "old-client", clientSecret: "old-secret" }, vault, dependencies),
    );
    values.set(
      "google-workspace",
      JSON.stringify({
        clientSecret: "old-secret",
        refreshTokens: { gmail: "refresh-token" },
        pendingRevocations: [],
      }),
    );
    await saveConnectors([connector]);
    const save = Effect.runPromise(
      saveGoogleClient({ clientId: "new-client", clientSecret: "new-secret" }, vault, dependencies),
    );
    await revokeStarted.promise;
    const snapshotAcquired = Promise.withResolvers<void>();
    const accountRead = Effect.runPromise(
      withPluginExecutionSnapshotLifecycle(() =>
        Effect.sync(() => snapshotAcquired.resolve()).pipe(
          Effect.andThen(
            googleAuthorizationHeaders("gmail", false, dependencies, vault).pipe(
              Effect.as(undefined),
              Effect.catch(() => Effect.void),
            ),
          ),
        ),
      ),
    );
    await snapshotAcquired.promise;
    revokeResponse.resolve(new Response(null, { status: 200 }));
    await Promise.race([
      Promise.all([save, accountRead]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Operation deadlocked")), 1_000).unref();
      }),
    ]);
    expect(await listConnectors()).toEqual([{ ...connector, enabled: false }]);
  });
});

describe("stdio child environment", () => {
  test("keeps only POSIX essentials and explicit connector values", () => {
    const environment = stdioChildEnvironment(
      { PLUGIN_TOKEN: "explicit", PATH: "/explicit/bin" },
      {
        PATH: "/ambient/bin",
        HOME: "/home/user",
        LANG: "en_US.UTF-8",
        AWS_SECRET_ACCESS_KEY: "ambient-secret",
        NODE_OPTIONS: "--require ambient.js",
      },
      "linux",
    );
    expect(environment).toEqual({
      PATH: "/explicit/bin",
      HOME: "/home/user",
      LANG: "en_US.UTF-8",
      PLUGIN_TOKEN: "explicit",
    });
  });

  test("matches Windows essentials case-insensitively without ambient secrets", () => {
    const environment = stdioChildEnvironment(
      { Path: "C:\\explicit" },
      {
        Path: "C:\\ambient",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\fixture",
        AZURE_CLIENT_SECRET: "ambient-secret",
      },
      "win32",
    );
    expect(environment).toEqual({
      SYSTEMROOT: "C:\\Windows",
      USERPROFILE: "C:\\Users\\fixture",
      Path: "C:\\explicit",
    });
  });
});
