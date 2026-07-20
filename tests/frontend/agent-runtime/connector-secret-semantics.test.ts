import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONNECTOR_MASK_TOKEN,
  type ConnectorConfig,
} from "../../../services/agent-runtime/src/connector-contract";
import { connectorConfigurationFingerprint } from "../../../services/agent-runtime/src/connector-configuration";
import {
  ConnectorConfigurationError,
  decodeConnectorUpsertPayload,
  enabledConnectors,
  listConnectors,
  resolveConnectorsFilePath,
  toConnectorView,
  upsertConnector,
  upsertConnectorInput,
  upsertConnectors,
} from "../../../services/agent-runtime/src/connectors-service";

let dataDir = "";
let previousDataDir: string | undefined;

beforeAll(async () => {
  previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  dataDir = await mkdtemp(join(tmpdir(), "local-studio-connector-secrets-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function connector(id: string, overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return {
    id,
    name: id,
    transport: "http",
    url: `https://${id}.example.test/mcp`,
    allowTools: ["read"],
    permissionReviewed: true,
    enabled: true,
    ...overrides,
  };
}

function customPayload(id: string, fields: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    name: id,
    transport: "http",
    url: `https://${id}.example.test/mcp`,
    allowTools: ["read"],
    permissionReviewed: true,
    enabled: true,
    ...fields,
  });
}

describe("connector secret semantics", () => {
  test("masks every present value and sorts location-aware metadata", () => {
    const sentinels = ["cookie-sentinel", "empty-sentinel", "session-sentinel", "custom-sentinel"];
    const view = toConnectorView(
      connector("view-secrets", {
        env: { zeta: sentinels[3], Cookie: sentinels[0], EMPTY: "" },
        headers: { SESSION: sentinels[2], Cookie: sentinels[1], EMPTY_HEADER: "" },
      }),
    );

    expect(CONNECTOR_MASK_TOKEN).toBe("••••••••");
    expect(view.env).toEqual({
      zeta: CONNECTOR_MASK_TOKEN,
      Cookie: CONNECTOR_MASK_TOKEN,
      EMPTY: CONNECTOR_MASK_TOKEN,
    });
    expect(view.headers).toEqual({
      SESSION: CONNECTOR_MASK_TOKEN,
      Cookie: CONNECTOR_MASK_TOKEN,
      EMPTY_HEADER: CONNECTOR_MASK_TOKEN,
    });
    expect(view.secret_keys).toEqual({
      env: ["Cookie", "EMPTY", "zeta"],
      headers: ["Cookie", "EMPTY_HEADER", "SESSION"],
    });
    const serialized = JSON.stringify(view);
    sentinels.forEach((sentinel) => expect(serialized).not.toContain(sentinel));
  });

  test("keeps raw secrets in authorization identity while views remain equal", () => {
    const first = connector("identity-secrets", {
      env: { CREDENTIAL: "identity-one" },
      headers: { Cookie: "header-one" },
    });
    const second = connector("identity-secrets", {
      env: { CREDENTIAL: "identity-two" },
      headers: { Cookie: "header-two" },
    });

    expect(toConnectorView(first)).toEqual(toConnectorView(second));
    expect(connectorConfigurationFingerprint(first)).not.toBe(
      connectorConfigurationFingerprint(second),
    );
  });

  test("preserves placeholders only at the same stored location and key", async () => {
    const id = "merge-secrets";
    await upsertConnectors([
      connector(id, {
        env: { CREDENTIAL: "env-sentinel", EMPTY: "", DELETE_ME: "delete-sentinel" },
        headers: { Cookie: "header-sentinel", DELETE_ME: "delete-header-sentinel" },
      }),
    ]);

    const [preserved] = await upsertConnectorInput(
      decodeConnectorUpsertPayload(
        customPayload(id, {
          env: { CREDENTIAL: CONNECTOR_MASK_TOKEN, EMPTY: CONNECTOR_MASK_TOKEN },
          headers: { Cookie: CONNECTOR_MASK_TOKEN },
        }),
      ),
    );
    expect(preserved?.env).toEqual({ CREDENTIAL: "env-sentinel", EMPTY: "" });
    expect(preserved?.headers).toEqual({ Cookie: "header-sentinel" });
    const persisted = await readFile(resolveConnectorsFilePath(), "utf8");
    expect(persisted).toContain("env-sentinel");
    expect(persisted).toContain("header-sentinel");
    expect(persisted).not.toContain(CONNECTOR_MASK_TOKEN);

    const beforeMissing = await readFile(resolveConnectorsFilePath(), "utf8");
    const missing = upsertConnectorInput(
      decodeConnectorUpsertPayload(customPayload(id, { env: { UNKNOWN: CONNECTOR_MASK_TOKEN } })),
    );
    await expect(missing).rejects.toBeInstanceOf(ConnectorConfigurationError);
    expect(await readFile(resolveConnectorsFilePath(), "utf8")).toBe(beforeMissing);

    const crossLocation = upsertConnectorInput(
      decodeConnectorUpsertPayload(
        customPayload(id, { headers: { CREDENTIAL: CONNECTOR_MASK_TOKEN } }),
      ),
    );
    await expect(crossLocation).rejects.toBeInstanceOf(ConnectorConfigurationError);
    expect(await readFile(resolveConnectorsFilePath(), "utf8")).toBe(beforeMissing);

    const [omitted] = await upsertConnectorInput(
      decodeConnectorUpsertPayload(
        customPayload(id, { env: { CREDENTIAL: CONNECTOR_MASK_TOKEN } }),
      ),
    );
    expect(omitted?.env).toEqual({ CREDENTIAL: "env-sentinel" });
    expect(omitted?.headers).toBeUndefined();
  });

  test("accepts only HTTP connector URLs without credentials", () => {
    for (const url of [
      "http://localhost:9911/mcp",
      "https://connector.example.test/path/@scope?email=agent@example.test#@fragment",
    ]) {
      expect(decodeConnectorUpsertPayload(customPayload("valid-url", { url })).url).toBe(url);
    }

    const rejected = [
      "connector.example.test/mcp",
      "ftp://connector.example.test/mcp",
      "file:///tmp/connector.sock",
      "ws://connector.example.test/mcp",
      "https://@connector.example.test/mcp",
      "https://:@connector.example.test/mcp",
      "http://synthetic-user@connector.example.test/mcp",
      "https://synthetic-user:synthetic-password@connector.example.test/mcp",
    ];
    for (const url of rejected) {
      try {
        decodeConnectorUpsertPayload(customPayload("invalid-url", { url }));
        throw new Error("Invalid connector URL was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorConfigurationError);
        expect(error instanceof Error ? error.message : "").toBe(
          "Connector configuration is invalid",
        );
        expect(error instanceof Error ? error.message : "").not.toContain(url);
      }
    }
  });

  test("rejects programmatic credential URLs before persistence", async () => {
    const file = resolveConnectorsFilePath();
    const before = await readFile(file, "utf8");
    for (const url of [
      "https://@programmatic.example.test/mcp",
      "https://:@programmatic.example.test/mcp",
      "https://synthetic-user:synthetic-password@programmatic.example.test/mcp",
    ]) {
      await expect(
        upsertConnectors([connector("programmatic-url", { url })]),
      ).rejects.toBeInstanceOf(ConnectorConfigurationError);
      expect(await readFile(file, "utf8")).toBe(before);
    }
  });

  test("rejects persisted credential URLs without rewriting or reflection", async () => {
    const file = resolveConnectorsFilePath();
    const previous = await readFile(file, "utf8");
    try {
      for (const url of [
        "https://@connector.example.test/mcp",
        "https://:@connector.example.test/mcp",
        "https://synthetic-user:synthetic-password@connector.example.test/mcp",
      ]) {
        const invalid = JSON.stringify({ connectors: [connector("persisted-url", { url })] });
        await writeFile(file, invalid);
        try {
          await listConnectors();
          throw new Error("Persisted credential URL was accepted");
        } catch (error) {
          expect(error).toBeInstanceOf(ConnectorConfigurationError);
          expect(error instanceof Error ? error.message : "").toBe(
            "Connector configuration is invalid",
          );
          expect(error instanceof Error ? error.message : "").not.toContain(url);
        }
        expect(await readFile(file, "utf8")).toBe(invalid);
      }
    } finally {
      await writeFile(file, previous);
    }
  });

  test("rejects reserved placeholders at every raw storage boundary", async () => {
    const file = resolveConnectorsFilePath();
    const previous = await readFile(file, "utf8");
    const invalid = [
      connector("persisted-mask-env", { env: { CREDENTIAL: CONNECTOR_MASK_TOKEN } }),
      connector("persisted-mask-header", { headers: { Cookie: CONNECTOR_MASK_TOKEN } }),
    ];
    try {
      for (const candidate of invalid) {
        const payload = JSON.stringify({ connectors: [candidate] });
        await writeFile(file, payload);
        await expect(listConnectors()).rejects.toBeInstanceOf(ConnectorConfigurationError);
        await expect(enabledConnectors()).rejects.toBeInstanceOf(ConnectorConfigurationError);
        expect(await readFile(file, "utf8")).toBe(payload);
      }
    } finally {
      await writeFile(file, previous);
    }

    for (const candidate of invalid) {
      await expect(upsertConnectors([candidate])).rejects.toBeInstanceOf(
        ConnectorConfigurationError,
      );
      expect(await readFile(file, "utf8")).toBe(previous);
    }
  });

  test("rejects existing same-key placeholders before raw storage or execution", async () => {
    const id = "existing-raw-mask";
    const raw = connector(id, {
      env: { CREDENTIAL: "raw-env-sentinel" },
      headers: { Cookie: "raw-header-sentinel" },
    });
    await upsertConnectors([raw]);
    const file = resolveConnectorsFilePath();
    const before = await readFile(file, "utf8");

    await expect(
      upsertConnector({ ...raw, env: { CREDENTIAL: CONNECTOR_MASK_TOKEN } }),
    ).rejects.toBeInstanceOf(ConnectorConfigurationError);
    await expect(
      upsertConnectors([{ ...raw, headers: { Cookie: CONNECTOR_MASK_TOKEN } }]),
    ).rejects.toBeInstanceOf(ConnectorConfigurationError);

    const persisted = await readFile(file, "utf8");
    expect(persisted).toBe(before);
    expect(persisted).not.toContain(CONNECTOR_MASK_TOKEN);
    const executable = (await enabledConnectors()).find((entry) => entry.id === id);
    expect(executable?.env).toEqual({ CREDENTIAL: "raw-env-sentinel" });
    expect(executable?.headers).toEqual({ Cookie: "raw-header-sentinel" });
    expect(JSON.stringify(executable)).not.toContain(CONNECTOR_MASK_TOKEN);
  });
});
