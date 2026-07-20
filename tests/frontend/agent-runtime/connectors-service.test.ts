import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  upsertConnectorInput,
  upsertConnectors,
} from "../../../services/agent-runtime/src/connectors-service";
import type { StoredConnectorConfig } from "../../../services/agent-runtime/src/connector-contract";
import {
  catalogConnectorConfiguration,
  connectorToolRisk,
} from "../../../services/agent-runtime/src/connector-policy";

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

  test("migrates an exact legacy catalog executable into its first-party risk policy", () => {
    const normalized = normalizeStoredConnector(
      connector({
        id: "github",
        transport: "stdio",
        url: undefined,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories", "create_issue"],
      }),
    );
    expect(normalized.connector.origin).toMatchObject({
      kind: "catalog",
      id: "github",
    });
    expect(normalized.connector.origin?.version).toBeString();
    expect(normalized.connector.command).not.toBe("npx");
    expect(connectorToolRisk(normalized.connector, "search_repositories")).toBe("read");
    expect(connectorToolRisk(normalized.connector, "create_issue")).toBe("mutating");
    expect(normalized.migrated).toBe(true);
  });

  test("upgrades an exact unversioned catalog claim without retaining drifted claims", () => {
    const exact = normalizeStoredConnector(
      connector({
        id: "github",
        transport: "stdio",
        url: undefined,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        allowTools: ["search_repositories"],
        origin: { kind: "catalog", id: "github" },
      }),
    );
    expect(exact.connector.origin?.version).toBeString();
    expect(exact.connector.enabled).toBe(true);
    const drifted = normalizeStoredConnector({
      ...exact.connector,
      command: "other",
      origin: { kind: "catalog", id: "github" },
    });
    expect(drifted.connector.origin).toBeUndefined();
    expect(drifted.connector.enabled).toBe(false);
    expect(drifted.connector.allowTools).toEqual([]);
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
