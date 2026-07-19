import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import {
  filterAllowedConnectorTools,
  ConnectorToolDeniedError,
  assertConnectorToolAllowed,
} from "../../../services/agent-runtime/src/connector-pool";
import {
  normalizeStoredConnector,
  protectManagedConnector,
  decodeConnectorUpsertPayload,
  listConnectors,
  removeConnector,
  replaceConnectorsIfCurrent,
  upsertConnectorInput,
  upsertConnectors,
} from "../../../services/agent-runtime/src/connectors-service";
import type {
  ConnectorConfig,
  StoredConnectorConfig,
} from "../../../services/agent-runtime/src/connector-contract";
import {
  catalogConnectorConfiguration,
  connectorToolRisk,
} from "../../../services/agent-runtime/src/connector-policy";
import {
  GITHUB_MCP_ARTIFACTS,
  GITHUB_MCP_VERSION,
} from "../../../services/agent-runtime/src/connector-artifacts";

let dataDir = "";
let previousDataDir: string | undefined;

beforeAll(async () => {
  previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  dataDir = await mkdtemp(join(tmpdir(), "local-studio-connectors-service-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const connector = (overrides: Partial<StoredConnectorConfig> = {}): StoredConnectorConfig => ({
  id: "fixture",
  name: "Fixture",
  transport: "http",
  url: "http://127.0.0.1:9911/mcp",
  enabled: true,
  ...overrides,
});

describe("connector grants", () => {
  test("migrates an omitted grant into disabled review-required state", () => {
    const normalized = normalizeStoredConnector(connector());
    expect(normalized.connector.enabled).toBe(false);
    expect(normalized.connector.permissionReviewed).toBe(false);
    expect(normalized.connector.allowTools).toEqual([]);
    expect(normalized.migrated).toBe(true);
  });

  test("preserves an existing explicit allowlist as reviewed", () => {
    const normalized = normalizeStoredConnector(connector({ allowTools: ["read"] }));
    expect(normalized.connector.enabled).toBe(true);
    expect(normalized.connector.permissionReviewed).toBe(true);
    expect(normalized.connector.allowTools).toEqual(["read"]);
    expect(
      filterAllowedConnectorTools(normalized.connector, [{ name: "read" }, { name: "write" }]),
    ).toEqual([{ name: "read" }]);
  });

  test("keeps empty grants and inventory drift fail closed", () => {
    const reviewed = normalizeStoredConnector(connector({ allowTools: [] })).connector;
    expect(filterAllowedConnectorTools(reviewed, [{ name: "new_tool" }])).toEqual([]);
    expect(() => assertConnectorToolAllowed(reviewed, "new_tool")).toThrow(
      ConnectorToolDeniedError,
    );
  });

  test("migrates legacy plugin grants without artifact or inventory identity fail closed", () => {
    const legacy = normalizeStoredConnector(
      connector({
        allowTools: ["observe"],
        permissionReviewed: true,
        origin: { kind: "plugin", id: "fixture", version: "1.0.0", binding: "server" },
      }),
    );
    expect(legacy.connector).toMatchObject({
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
    expect(legacy.migrated).toBe(true);
  });

  test("preserves plugin grants bound to artifact and inventory identity", () => {
    const normalized = normalizeStoredConnector(
      connector({
        allowTools: ["observe"],
        permissionReviewed: true,
        origin: {
          kind: "plugin",
          id: "fixture",
          version: "1.0.0",
          binding: "server",
          artifactDigest: "sha256:artifact",
          inventoryDigest: "sha256:inventory",
        },
      }),
    );
    expect(normalized.connector).toMatchObject({
      allowTools: ["observe"],
      permissionReviewed: true,
      enabled: true,
    });
    expect(normalized.migrated).toBe(false);
  });

  test("migrates a stdio plugin grant without executable identity fail closed", () => {
    const normalized = normalizeStoredConnector(
      connector({
        transport: "stdio",
        url: undefined,
        command: "/usr/bin/fixture",
        allowTools: ["observe"],
        permissionReviewed: true,
        origin: {
          kind: "plugin",
          id: "fixture",
          version: "1.0.0",
          binding: "server",
          artifactDigest: "sha256:artifact",
          inventoryDigest: "sha256:inventory",
        },
      }),
    );
    expect(normalized.connector).toMatchObject({
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
    expect(normalized.migrated).toBe(true);
  });

  test("rejects executable drift while retaining a catalog risk identity", () => {
    const catalog = catalogConnectorConfiguration({
      id: "github",
      catalogId: "github",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: ["search_repositories"],
      permissionReviewed: true,
      enabled: true,
    });
    expect(protectManagedConnector(catalog)).toEqual(catalog);
    expect(() => protectManagedConnector({ ...catalog, command: "other" })).toThrow(
      "configuration is immutable",
    );
    const drifted = normalizeStoredConnector({ ...catalog, command: "other" });
    expect(drifted.connector.origin).toBeUndefined();
    expect(drifted.connector.enabled).toBe(false);
    expect(drifted.connector.permissionReviewed).toBe(false);
    expect(drifted.connector.allowTools).toEqual([]);
    expect(connectorToolRisk(drifted.connector, "search_repositories")).toBe("critical");
  });

  test("migrates an exact legacy generated GitHub connector disabled for review", () => {
    const normalized = normalizeStoredConnector(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        url: undefined,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories", "create_issue"],
        permissionReviewed: true,
      }),
    );
    expect(normalized.connector.origin).toMatchObject({
      kind: "catalog",
      id: "github",
    });
    expect(normalized.connector.origin?.version).toBeString();
    expect(normalized.connector.origin?.artifactDigest).toStartWith("sha256:");
    expect(normalized.connector.origin?.inventoryDigest).toStartWith("sha256:");
    expect(normalized.connector.command).not.toBe("npx");
    expect(normalized.connector.args).toEqual([
      "stdio",
      "--read-only",
      "--toolsets=repos,issues,pull_requests",
    ]);
    expect(normalized.connector.allowTools).toEqual([]);
    expect(normalized.connector.permissionReviewed).toBe(false);
    expect(normalized.connector.enabled).toBe(false);
    expect(connectorToolRisk(normalized.connector, "search_repositories")).toBe("read");
    expect(connectorToolRisk(normalized.connector, "create_issue")).toBe("critical");
    expect(normalized.migrated).toBe(true);
  });

  test("upgrades exact unversioned and prior-version generated claims without retaining grants", () => {
    const exact = normalizeStoredConnector(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        url: undefined,
        command: "/usr/local/bin/npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories"],
        permissionReviewed: true,
        origin: { kind: "catalog", id: "github" },
      }),
    );
    expect(exact.connector.origin?.version).toBeString();
    expect(exact.connector.enabled).toBe(false);
    expect(exact.connector.permissionReviewed).toBe(false);
    expect(exact.connector.allowTools).toEqual([]);
    const windows = normalizeStoredConnector(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        url: undefined,
        command: "C:\\Program Files\\nodejs\\npx.cmd",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories"],
        permissionReviewed: true,
        origin: { kind: "catalog", id: "github" },
      }),
    );
    expect(windows.connector.origin).toEqual(exact.connector.origin);
    expect(windows.connector.enabled).toBe(false);
    expect(windows.connector.permissionReviewed).toBe(false);
    expect(windows.connector.allowTools).toEqual([]);
    const versioned = normalizeStoredConnector(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        url: undefined,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories"],
        permissionReviewed: true,
        origin: { kind: "catalog", id: "github", version: "2026-07-19.1" },
      }),
    );
    expect(versioned.connector.origin).toEqual(exact.connector.origin);
    expect(versioned.connector.enabled).toBe(false);
    const drifted = normalizeStoredConnector({
      ...exact.connector,
      command: "other",
      origin: { kind: "catalog", id: "github" },
    });
    expect(drifted.connector.origin).toBeUndefined();
    expect(drifted.connector.enabled).toBe(false);
    expect(drifted.connector.allowTools).toEqual([]);
  });

  test("migrates a managed GitHub connector across supported targets and data directories", () => {
    const current = catalogConnectorConfiguration({
      id: "github",
      catalogId: "github",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: ["search_repositories"],
      permissionReviewed: true,
      enabled: true,
    });
    const currentDigest = current.origin?.artifactDigest;
    const previous = Object.values(GITHUB_MCP_ARTIFACTS).find(
      (artifact) => `sha256:${artifact.executableSha256}` !== currentDigest,
    );
    const selected = Object.values(GITHUB_MCP_ARTIFACTS).find(
      (artifact) => `sha256:${artifact.executableSha256}` === currentDigest,
    );
    if (!previous || !selected || !current.origin) throw new Error("GitHub artifact unavailable");
    const previousPaths = previous.platform === "win32" ? win32 : posix;
    const currentPaths = selected.platform === "win32" ? win32 : posix;
    const previousConnector: ConnectorConfig = {
      ...current,
      command: previousPaths.join(
        previous.platform === "win32" ? "C:\\Users\\fixture\\Studio" : "/var/tmp/studio",
        "runtime",
        "connectors",
        "github-mcp-server",
        previous.version,
        previous.executableName,
      ),
      origin: {
        ...current.origin,
        artifactDigest: `sha256:${previous.executableSha256}`,
      },
    };
    const movedConnector: ConnectorConfig = {
      ...current,
      command: currentPaths.join(
        selected.platform === "win32" ? "C:\\Users\\fixture\\Moved" : "/var/tmp/moved",
        "runtime",
        "connectors",
        "github-mcp-server",
        selected.version,
        selected.executableName,
      ),
    };
    if (!previousConnector.command) throw new Error("GitHub command unavailable");
    for (const candidate of [previousConnector, movedConnector]) {
      const normalized = normalizeStoredConnector(candidate);
      expect(normalized.connector.command).toBe(current.command);
      expect(normalized.connector.origin).toEqual(current.origin);
      expect(normalized.connector.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "secret" });
      expect(normalized.connector.allowTools).toEqual([]);
      expect(normalized.connector.permissionReviewed).toBe(false);
      expect(normalized.connector.enabled).toBe(false);
      expect(normalized.migrated).toBe(true);
    }
    const customized = [
      { ...previousConnector, name: "My GitHub" },
      {
        ...previousConnector,
        args: [...(previousConnector.args ?? []), "--custom"],
      },
      { ...previousConnector, cwd: "/tmp/custom" },
      { ...previousConnector, env: { ...previousConnector.env, GITHUB_HOST: "github.example" } },
      { ...previousConnector, command: "/var/tmp/not-managed/github-mcp-server" },
      {
        ...previousConnector,
        command: previousConnector.command.replace(
          `${previousPaths.sep}runtime`,
          `${previousPaths.sep}custom${previousPaths.sep}..${previousPaths.sep}runtime`,
        ),
      },
      {
        ...previousConnector,
        origin: { ...previousConnector.origin, version: "unknown" },
      },
      {
        ...previousConnector,
        origin: { ...previousConnector.origin, artifactDigest: "sha256:unknown" },
      },
      {
        ...previousConnector,
        origin: { ...previousConnector.origin, inventoryDigest: "sha256:unknown" },
      },
    ];
    for (const candidate of customized) {
      const normalized = normalizeStoredConnector(candidate);
      expect(normalized.connector.origin).toBeUndefined();
      expect(normalized.connector.command).toBe(candidate.command);
    }
    const originless = { ...previousConnector, origin: undefined };
    expect(normalizeStoredConnector(originless)).toEqual({
      connector: originless,
      migrated: false,
    });
  });

  test("migrates managed GitHub connectors from shallow POSIX and Windows data directories", () => {
    const current = catalogConnectorConfiguration({
      id: "github",
      catalogId: "github",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: ["search_repositories"],
      permissionReviewed: true,
      enabled: true,
    });
    if (!current.origin) throw new Error("GitHub artifact unavailable");
    const candidates = [
      {
        artifact: GITHUB_MCP_ARTIFACTS["linux-x64"],
        command: posix.join(
          "/data",
          "runtime",
          "connectors",
          "github-mcp-server",
          GITHUB_MCP_VERSION,
          "github-mcp-server",
        ),
      },
      {
        artifact: GITHUB_MCP_ARTIFACTS["win32-x64"],
        command: win32.join(
          "D:\\LocalStudioData",
          "runtime",
          "connectors",
          "github-mcp-server",
          GITHUB_MCP_VERSION,
          "github-mcp-server.exe",
        ),
      },
    ];
    for (const { artifact, command } of candidates) {
      const normalized = normalizeStoredConnector({
        ...current,
        command,
        origin: {
          ...current.origin,
          artifactDigest: `sha256:${artifact.executableSha256}`,
        },
      });
      expect(normalized.connector.command).toBe(current.command);
      expect(normalized.connector.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "secret" });
      expect(normalized.connector.allowTools).toEqual([]);
      expect(normalized.connector.permissionReviewed).toBe(false);
      expect(normalized.connector.enabled).toBe(false);
      expect(normalized.migrated).toBe(true);
    }
  });

  test("leaves customized legacy GitHub executions originless and unchanged", () => {
    const base: StoredConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: ["search_repositories"],
      permissionReviewed: true,
      enabled: true,
    };
    const customized = [
      { ...base, name: "My GitHub" },
      { ...base, args: [...(base.args ?? []), "--custom"] },
      { ...base, env: { ...base.env, GITHUB_HOST: "github.example" } },
      { ...base, cwd: "/tmp/custom-github" },
      { ...base, command: "npx.cmd" },
      { ...base, command: "/opt/custom-wrapper/npx" },
      { ...base, command: "/opt/custom-wrapper/npx.cmd" },
      { ...base, command: "C:\\Custom\\npx.cmd" },
    ];
    for (const candidate of customized) {
      const normalized = normalizeStoredConnector(candidate);
      expect(normalized.connector).toEqual(candidate);
      expect(normalized.connector.origin).toBeUndefined();
      expect(normalized.migrated).toBe(false);
    }
  });

  test("preserves a persisted originless GitHub wrapper", async () => {
    const file = join(dataDir, "connectors.json");
    const custom: StoredConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "/opt/custom-wrapper/npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: ["search_repositories"],
      permissionReviewed: true,
      enabled: true,
    };
    try {
      await writeFile(file, JSON.stringify({ connectors: [custom] }));
      expect(await listConnectors()).toEqual([custom]);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ connectors: [custom] });
    } finally {
      await rm(file, { force: true });
    }
  });

  test("reconstructs catalog launch fields and preserves only masked approved credentials", async () => {
    const initial = decodeConnectorUpsertPayload(
      JSON.stringify({
        id: "github",
        catalogId: "github",
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret-token" },
        allowTools: [],
        permissionReviewed: false,
        enabled: false,
      }),
    );
    const [created] = await upsertConnectorInput(initial);
    if (!created) throw new Error("Catalog connector was not created");
    const updated = decodeConnectorUpsertPayload(
      JSON.stringify({
        id: "github",
        catalogId: "github",
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "••••••••" },
        allowTools: ["search_repositories"],
        permissionReviewed: true,
        enabled: true,
      }),
    );
    const [saved] = await upsertConnectorInput(updated);
    if (!saved) throw new Error("Catalog connector was not saved");
    expect(saved.command).toBe(created.command);
    expect(saved.args).toEqual(created.args);
    expect(saved.origin).toEqual(created.origin);
    expect(saved.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "secret-token" });
    expect((await listConnectors())[0]?.env).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: "secret-token",
    });
    const originless = decodeConnectorUpsertPayload(
      JSON.stringify({
        id: "github",
        transport: "stdio",
        command: created.command,
        args: created.args,
        allowTools: ["search_repositories"],
        permissionReviewed: true,
        enabled: true,
      }),
    );
    await expect(upsertConnectorInput(originless)).rejects.toThrow("configuration is immutable");
  });

  test("rejects catalog launch shaping and unknown environment keys", async () => {
    expect(() =>
      decodeConnectorUpsertPayload(
        JSON.stringify({
          id: "github",
          catalogId: "github",
          command: "sh",
          args: ["-c", "evil"],
          cwd: "/tmp",
        }),
      ),
    ).toThrow("Invalid connector payload");
    const hostile = decodeConnectorUpsertPayload(
      JSON.stringify({
        id: "github",
        catalogId: "github",
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "secret",
          PATH: "/tmp",
          NODE_OPTIONS: "--require=/tmp/evil",
          npm_config_prefix: "/tmp",
        },
      }),
    );
    await expect(upsertConnectorInput(hostile)).rejects.toThrow("environment is invalid");
  });

  test("preserves plugin ownership only across exact execution updates", async () => {
    const plugin = {
      id: "plugin-fixture-server",
      name: "Plugin fixture",
      transport: "http" as const,
      url: "http://127.0.0.1:9912/mcp",
      headers: { Authorization: "Bearer secret" },
      allowTools: ["read"],
      permissionReviewed: true,
      origin: { kind: "plugin", id: "fixture", version: "1", binding: "server" },
      enabled: false,
    };
    await upsertConnectors([plugin]);
    const exact = decodeConnectorUpsertPayload(
      JSON.stringify({
        id: plugin.id,
        name: plugin.name,
        transport: plugin.transport,
        url: plugin.url,
        headers: { Authorization: "••••••••" },
        allowTools: plugin.allowTools,
        permissionReviewed: true,
        enabled: true,
      }),
    );
    const preserved = (await upsertConnectorInput(exact)).find((entry) => entry.id === plugin.id);
    expect(preserved?.origin).toEqual(plugin.origin);
    const drifted = decodeConnectorUpsertPayload(
      JSON.stringify({ ...exact, url: "http://127.0.0.1:9913/mcp" }),
    );
    const downgraded = (await upsertConnectorInput(drifted)).find(
      (entry) => entry.id === plugin.id,
    );
    if (!downgraded) throw new Error("Plugin connector was not updated");
    expect(downgraded?.origin).toBeUndefined();
    expect(connectorToolRisk(downgraded, "read")).toBe("critical");
  });
});

describe("connector state compare-and-swap", () => {
  const current = (id: string): ConnectorConfig => ({
    id,
    name: id,
    transport: "http",
    url: `http://${id}.test/mcp`,
    allowTools: ["observe"],
    permissionReviewed: true,
    enabled: true,
  });

  test("keeps an explicit removal instead of applying a stale replacement", async () => {
    const original = current("cas-removed");
    await upsertConnectors([original]);
    await removeConnector(original.id);
    const result = await replaceConnectorsIfCurrent([
      { expected: original, replacement: { ...original, enabled: false } },
    ]);
    expect(result.committed).toBe(false);
    expect(result.connectors.some((entry) => entry.id === original.id)).toBe(false);
    expect((await listConnectors()).some((entry) => entry.id === original.id)).toBe(false);
  });

  test("rejects a concurrent edit atomically across every target", async () => {
    const first = current("cas-first");
    const second = current("cas-second");
    await upsertConnectors([first, second]);
    await upsertConnectors([{ ...second, name: "concurrent edit" }]);
    const result = await replaceConnectorsIfCurrent([
      { expected: first, replacement: { ...first, enabled: false } },
      { expected: second, replacement: { ...second, enabled: false } },
    ]);
    expect(result.committed).toBe(false);
    expect(result.connectors.find((entry) => entry.id === first.id)?.enabled).toBe(true);
    expect(result.connectors.find((entry) => entry.id === second.id)).toMatchObject({
      name: "concurrent edit",
      enabled: true,
    });
  });

  test("does not overwrite a concurrently created expected-absence target", async () => {
    const replacement = current("cas-created");
    const concurrent = { ...replacement, name: "concurrent owner", enabled: false };
    await upsertConnectors([concurrent]);
    const result = await replaceConnectorsIfCurrent([{ expected: null, replacement }]);
    expect(result.committed).toBe(false);
    expect(result.connectors.find((entry) => entry.id === replacement.id)).toEqual(concurrent);
  });
});
