import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { ConnectorConfig } from "../src/connector-contract";
import { callConnectorTool } from "../src/connector-pool";
import { listConnectors, saveConnectors, toConnectorView } from "../src/connectors-service";
import { stdioChildEnvironment } from "../src/mcp-client";
import { pluginConnectorConfigurationDigest } from "../src/plugin-connector-identity";
import { discoverPluginBundles, type PluginSource } from "../src/plugin-discovery";
import { preparePluginExecutionSnapshot, verifyPluginExecutionSnapshot } from "../src/plugin-execution-snapshot";
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
      JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [outside], cwd: "." } } }),
    );
    await expect(Effect.runPromise(setPluginEnabled("fixture", true, source))).rejects.toThrow(/escapes its bundle/);
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
    const prepared = await Effect.runPromise(preparePluginExecutionSnapshot(bundle, { ...connector, command: realpathSync(path.join(root, "server.js")), args: [] }));
    expect(prepared.command).not.toBe(realpathSync(path.join(root, "server.js")));
    expect(readFileSync(prepared.command ?? "", "utf8")).toBe("process.exit(1)");
    writeFileSync(path.join(root, "server.js"), "process.exit(0)");
    await Effect.runPromise(verifyPluginExecutionSnapshot(prepared));
    expect(readFileSync(prepared.command ?? "", "utf8")).toBe("process.exit(1)");
    chmodSync(prepared.command ?? "", 0o700);
    await expect(Effect.runPromise(verifyPluginExecutionSnapshot(prepared))).rejects.toThrow(/writable/);
  });

  test("preserves an unchanged approval only while its snapshot verifies", async () => {
    const { root, source } = fixture();
    chmodSync(path.join(root, "server.js"), 0o755);
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = await approvedConnector(root, source);
    const prepared = await Effect.runPromise(preparePluginExecutionSnapshot(bundle, connector));
    await saveConnectors([prepared]);
    await Effect.runPromise(refreshEnabledPluginConnectors(source));
    expect((await listConnectors())[0]).toMatchObject({ enabled: true, allowTools: ["read"] });
  });

  test("revokes a host-runtime snapshot when its runtime identity is removed", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const prepared = await Effect.runPromise(
      preparePluginExecutionSnapshot(bundle, await approvedConnector(root, source)),
    );
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
    const prepared = await Effect.runPromise(
      preparePluginExecutionSnapshot(bundle, await approvedConnector(root, source)),
    );
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
      await Effect.runPromise(preparePluginExecutionSnapshot(bundle, approved)),
      await Effect.runPromise(
        preparePluginExecutionSnapshot(bundle, {
          ...approved,
          command: realpathSync(path.join(root, "server.js")),
          args: [],
        }),
      ),
    ]) {
      const changed = prepared.origin?.runtimeDigest
        ? { ...prepared, args: [path.join(path.dirname(root), "outside.js")] }
        : { ...prepared, command: path.join(path.dirname(root), "outside.js") };
      if (!changed.origin) throw new Error("prepared connector has no origin");
      await saveConnectors([{ ...changed, origin: { ...changed.origin, configurationDigest: pluginConnectorConfigurationDigest(changed) } }]);
      await Effect.runPromise(refreshEnabledPluginConnectors(source));
      expect((await listConnectors())[0]).toMatchObject({ enabled: false, allowTools: [] });
    }
  });

  test("revokes a switch to a different entry inside the approved snapshot", async () => {
    const { root, source } = fixture();
    writeFileSync(path.join(root, "other.js"), "process.exit(0)");
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const prepared = await Effect.runPromise(
      preparePluginExecutionSnapshot(bundle, await approvedConnector(root, source)),
    );
    const entry = prepared.args?.[0];
    if (!entry || !prepared.origin) throw new Error("prepared connector is incomplete");
    const changed = { ...prepared, args: [path.join(path.dirname(entry), "other.js")] };
    await saveConnectors([{ ...changed, origin: { ...prepared.origin, configurationDigest: pluginConnectorConfigurationDigest(changed) } }]);
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
    await expect(Effect.runPromise(preparePluginExecutionSnapshot(bundle, { ...connector, command: realpathSync(path.join(root, "server.js")), args: [] }))).rejects.toThrow(/changed while snapshotting/);
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
