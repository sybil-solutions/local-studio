import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "../../../frontend/node_modules/effect/dist/index.js";
import { NextRequest } from "../../../frontend/node_modules/next/server";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorsResponseSchema,
  type ConnectorConfig,
} from "../../../services/agent-runtime/src/connector-contract";
import {
  enabledConnectors,
  resolveConnectorsFilePath,
  toConnectorView,
  upsertConnectors,
} from "../../../services/agent-runtime/src/connectors-service";
import {
  closePooledConnection,
  listConnectorTools,
} from "../../../services/agent-runtime/src/connector-pool";
import {
  DELETE as removeConnector,
  GET as listConnectors,
  POST as saveConnector,
} from "../../../frontend/src/app/api/agent/connectors/route";

const exact = { onExcessProperty: "error" } as const;
const decodeConnectors = Schema.decodeUnknownSync(ConnectorsResponseSchema, exact);
const endpoint = "https://route-secrets.example.test/mcp";
const connectorId = "route-secrets";
const envSentinel = "synthetic-env-sentinel";
const headerSentinel = "synthetic-header-sentinel";
let dataDir = "";
let previousDataDir: string | undefined;
let previousDesktop: string | undefined;
let originalFetch: typeof globalThis.fetch;
const capturedHeaders: Headers[] = [];

function connector(id = connectorId, overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return {
    id,
    name: id,
    transport: "http",
    url: endpoint,
    env: { CREDENTIAL: envSentinel },
    headers: { Cookie: headerSentinel },
    allowTools: ["read"],
    permissionReviewed: true,
    enabled: true,
    ...overrides,
  };
}

function rpcRequest(body: BodyInit | null | undefined): { id: unknown; method: unknown } {
  if (typeof body !== "string") return { id: null, method: null };
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object") return { id: null, method: null };
  return { id: Reflect.get(parsed, "id"), method: Reflect.get(parsed, "method") };
}

beforeAll(async () => {
  previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
  dataDir = await mkdtemp(join(tmpdir(), "local-studio-connector-route-secrets-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  delete process.env.LOCAL_STUDIO_DESKTOP;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== endpoint) return originalFetch(input, init);
    capturedHeaders.push(new Headers(init?.headers));
    if (init?.method === "GET") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const request = rpcRequest(init?.body);
    if (request.id === undefined) return new Response(null, { status: 202 });
    const result =
      request.method === "tools/list"
        ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
        : {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "route-secrets-fixture", version: "1.0.0" },
          };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
});

afterAll(async () => {
  await closePooledConnection(connectorId);
  await closePooledConnection("route-delete-target");
  await closePooledConnection("route-delete-visible");
  globalThis.fetch = originalFetch;
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
  else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
  await rm(dataDir, { recursive: true, force: true });
});

describe("connector secret route", () => {
  test("masks GET and POST while executing only the raw stored values", async () => {
    await upsertConnectors([connector()]);
    const listed = await listConnectors(new NextRequest("http://127.0.0.1/api/agent/connectors"));
    expect(listed.status).toBe(200);
    const listText = await listed.text();
    expect(listText).not.toContain(envSentinel);
    expect(listText).not.toContain(headerSentinel);
    const listBody = decodeConnectors(JSON.parse(listText));
    const view = listBody.connectors.find((entry) => entry.id === connectorId);
    expect(view?.env).toEqual({ CREDENTIAL: CONNECTOR_MASK_TOKEN });
    expect(view?.headers).toEqual({ Cookie: CONNECTOR_MASK_TOKEN });
    expect(view?.secret_keys).toEqual({ env: ["CREDENTIAL"], headers: ["Cookie"] });

    const masked = toConnectorView(connector());
    const saved = await saveConnector(
      new NextRequest("http://127.0.0.1/api/agent/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: masked.id,
          name: masked.name,
          transport: masked.transport,
          url: masked.url,
          env: masked.env,
          headers: masked.headers,
          allowTools: masked.allowTools,
          permissionReviewed: masked.permissionReviewed,
          enabled: masked.enabled,
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const saveText = await saved.text();
    expect(saveText).not.toContain(envSentinel);
    expect(saveText).not.toContain(headerSentinel);
    const raw = (await enabledConnectors()).find((entry) => entry.id === connectorId);
    expect(raw?.env).toEqual({ CREDENTIAL: envSentinel });
    expect(raw?.headers).toEqual({ Cookie: headerSentinel });

    expect(await listConnectorTools(connectorId)).toEqual([
      { name: "read", inputSchema: { type: "object" } },
    ]);
    expect(capturedHeaders.length).toBeGreaterThan(0);
    capturedHeaders.forEach((headers) => {
      expect(headers.get("Cookie")).toBe(headerSentinel);
      expect(headers.get("Cookie")).not.toBe(CONNECTOR_MASK_TOKEN);
    });
  });

  test("masks remaining connectors in DELETE responses", async () => {
    await upsertConnectors([
      connector("route-delete-target"),
      connector("route-delete-visible", {
        env: { SESSION: "delete-env-sentinel" },
        headers: { CREDENTIAL: "delete-header-sentinel" },
      }),
    ]);
    const response = await removeConnector(
      new NextRequest("http://127.0.0.1/api/agent/connectors?id=route-delete-target", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("delete-env-sentinel");
    expect(text).not.toContain("delete-header-sentinel");
    const visible = decodeConnectors(JSON.parse(text)).connectors.find(
      (entry) => entry.id === "route-delete-visible",
    );
    expect(visible?.env).toEqual({ SESSION: CONNECTOR_MASK_TOKEN });
    expect(visible?.headers).toEqual({ CREDENTIAL: CONNECTOR_MASK_TOKEN });
  });

  test("returns a generic typed conflict for invalid placeholders and URLs", async () => {
    const placeholderSentinel = "placeholder-response-sentinel";
    await upsertConnectors([connector("route-invalid-placeholder")]);
    const invalidPlaceholder = await saveConnector(
      new NextRequest("http://127.0.0.1/api/agent/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "route-invalid-placeholder",
          name: "route-invalid-placeholder",
          transport: "http",
          url: endpoint,
          env: { [placeholderSentinel]: CONNECTOR_MASK_TOKEN },
          allowTools: ["read"],
          permissionReviewed: true,
          enabled: true,
        }),
      }),
    );
    expect(invalidPlaceholder.status).toBe(409);
    const invalidPlaceholderText = await invalidPlaceholder.text();
    expect(invalidPlaceholderText).toBe('{"error":"Connector configuration is invalid"}');
    expect(invalidPlaceholderText).not.toContain(placeholderSentinel);

    const credentialUrl =
      "https://synthetic-user:synthetic-password@route-secrets.example.test/mcp";
    const invalidUrl = await saveConnector(
      new NextRequest("http://127.0.0.1/api/agent/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "route-invalid-url",
          name: "route-invalid-url",
          transport: "http",
          url: credentialUrl,
          allowTools: [],
          permissionReviewed: true,
          enabled: false,
        }),
      }),
    );
    expect(invalidUrl.status).toBe(409);
    const invalidUrlText = await invalidUrl.text();
    expect(invalidUrlText).toBe('{"error":"Connector configuration is invalid"}');
    expect(invalidUrlText).not.toContain(credentialUrl);
    expect(invalidUrlText).not.toContain("synthetic-password");
  });

  test("returns a generic conflict for invalid persisted secrets and URLs", async () => {
    const file = resolveConnectorsFilePath();
    const previous = await readFile(file, "utf8");
    const credentialUrl =
      "https://persisted-user:persisted-password@route-secrets.example.test/mcp";
    const cases = [
      JSON.stringify({ connectors: [connector("route-persisted-url", { url: credentialUrl })] }),
      JSON.stringify({
        connectors: [
          connector("route-persisted-mask", {
            env: { CREDENTIAL: CONNECTOR_MASK_TOKEN },
            headers: undefined,
          }),
        ],
      }),
    ];
    try {
      for (const payload of cases) {
        await writeFile(file, payload);
        const response = await listConnectors(
          new NextRequest("http://127.0.0.1/api/agent/connectors"),
        );
        expect(response.status).toBe(409);
        const text = await response.text();
        expect(text).toBe('{"error":"Connector configuration is invalid"}');
        expect(text).not.toContain(credentialUrl);
        expect(text).not.toContain("persisted-password");
        expect(text).not.toContain(CONNECTOR_MASK_TOKEN);
        expect(await readFile(file, "utf8")).toBe(payload);
      }
    } finally {
      await writeFile(file, previous);
    }
  });
});
