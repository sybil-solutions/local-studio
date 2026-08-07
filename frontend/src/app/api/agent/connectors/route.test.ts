import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { Schema } from "effect";
import { NextRequest } from "next/server";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorsResponseSchema,
  type ConnectorConfig,
} from "@local-studio/agent-runtime/connector-contract";
import {
  listConnectors,
  resolveConnectorsFilePath,
  upsertConnectors,
} from "@local-studio/agent-runtime/connectors-service";
import { DELETE, GET, POST } from "./route";

const originalDataDirectory = process.env.LOCAL_STUDIO_DATA_DIR;
const roots: string[] = [];
const decodeResponse = Schema.decodeUnknownSync(ConnectorsResponseSchema);
afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDirectory;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function useDataDirectory(): void {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-connector-route-"));
  roots.push(root);
  process.env.LOCAL_STUDIO_DATA_DIR = root;
}

const connector = (id: string, overrides: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  id,
  name: id,
  transport: "http",
  url: `https://${id}.example.test/mcp`,
  enabled: true,
  ...overrides,
});
const request = (path = "", init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest =>
  new NextRequest(`http://127.0.0.1/api/agent/connectors${path}`, init);
const post = (body: unknown) => POST(request("", { method: "POST", body: JSON.stringify(body) }));
const assertNoSecrets = (text: string, ...secrets: string[]): void =>
  secrets.forEach((secret) => assert.equal(text.includes(secret), false));
const prototypeSecret = (value: string): Record<string, string> =>
  Object.fromEntries([["__proto__", value]]);

describe("connector route secret boundaries", () => {
  test("masks arbitrary values in list and masked update responses", async () => {
    useDataDirectory();
    const id = "route-secrets";
    const envSentinel = "route-env-sentinel";
    const headerSentinel = "route-header-sentinel";
    await upsertConnectors([
      connector(id, {
        env: { CREDENTIAL: envSentinel },
        headers: { Cookie: headerSentinel },
      }),
    ]);

    const listed = await GET(request());
    const listText = await listed.text();
    assert.equal(listed.status, 200);
    assertNoSecrets(listText, envSentinel, headerSentinel);
    const view = decodeResponse(JSON.parse(listText)).connectors[0];
    assert.deepEqual(view?.env, { CREDENTIAL: CONNECTOR_MASK_TOKEN });
    assert.deepEqual(view?.headers, { Cookie: CONNECTOR_MASK_TOKEN });
    assert.deepEqual(view?.secret_keys, { env: ["CREDENTIAL"], headers: ["Cookie"] });

    const saved = await post({ ...view, enabled: false });
    const saveText = await saved.text();
    assert.equal(saved.status, 200);
    assertNoSecrets(saveText, envSentinel, headerSentinel);
    const [raw] = await listConnectors();
    assert.deepEqual(raw?.env, { CREDENTIAL: envSentinel });
    assert.deepEqual(raw?.headers, { Cookie: headerSentinel });
    assert.equal(raw?.enabled, false);
  });

  test("rejects unknown masks and URL userinfo without reflecting values", async () => {
    useDataDirectory();
    const id = "route-invalid";
    await upsertConnectors([connector(id, { env: { EXISTING: "stored-sentinel" } })]);
    const before = readFileSync(resolveConnectorsFilePath(), "utf8");
    const unknownKey = "unknown-mask-sentinel";
    const unknown = await post({
      id,
      transport: "http",
      url: `https://${id}.example.test/mcp`,
      env: { [unknownKey]: CONNECTOR_MASK_TOKEN },
    });
    const unknownText = await unknown.text();
    assert.equal(unknown.status, 409);
    assert.equal(unknownText, '{"error":"Connector configuration is invalid"}');
    assert.equal(unknownText.includes(unknownKey), false);
    assert.equal(readFileSync(resolveConnectorsFilePath(), "utf8"), before);

    const credentialUrl = "https://synthetic-user:synthetic-password@example.test/mcp";
    const invalidUrl = await post({ id: "url-userinfo", transport: "http", url: credentialUrl });
    const invalidUrlText = await invalidUrl.text();
    assert.equal(invalidUrl.status, 400);
    assert.equal(invalidUrlText, '{"error":"invalid connector payload"}');
    assertNoSecrets(invalidUrlText, credentialUrl, "synthetic-password");

    writeFileSync(
      resolveConnectorsFilePath(),
      JSON.stringify({ connectors: [connector("persisted-userinfo", { url: credentialUrl })] }),
    );
    const listed = await GET(request());
    const listedText = await listed.text();
    assert.equal(listed.status, 409);
    assert.equal(listedText, '{"error":"Connector configuration is invalid"}');
    assertNoSecrets(listedText, credentialUrl, "synthetic-password");
  });

  test("masks remaining connector values in delete responses", async () => {
    useDataDirectory();
    await upsertConnectors([
      connector("delete-target"),
      connector("delete-visible", {
        env: { SESSION: "delete-env-sentinel" },
        headers: { CREDENTIAL: "delete-header-sentinel" },
      }),
    ]);
    const response = await DELETE(request("?id=delete-target", { method: "DELETE" }));
    const text = await response.text();
    assert.equal(response.status, 200);
    assertNoSecrets(text, "delete-env-sentinel", "delete-header-sentinel");
    const visible = decodeResponse(JSON.parse(text)).connectors[0];
    assert.deepEqual(visible?.secret_keys, { env: ["SESSION"], headers: ["CREDENTIAL"] });
  });

  test("preserves prototype-named secrets through raw and masked posts", async () => {
    useDataDirectory();
    const id = "route-prototype-secrets";
    const envSentinel = "route-prototype-env-sentinel";
    const headerSentinel = "route-prototype-header-sentinel";
    const input = {
      id,
      transport: "http",
      url: `https://${id}.example.test/mcp`,
      env: prototypeSecret(envSentinel),
      headers: prototypeSecret(headerSentinel),
    };

    const rawResponse = await post(input);
    const rawText = await rawResponse.text();
    assert.equal(rawResponse.status, 200);
    assertNoSecrets(rawText, envSentinel, headerSentinel);
    const view = decodeResponse(JSON.parse(rawText)).connectors[0];
    assert.deepEqual(view?.env, prototypeSecret(CONNECTOR_MASK_TOKEN));
    assert.deepEqual(view?.headers, prototypeSecret(CONNECTOR_MASK_TOKEN));
    assert.deepEqual(view?.secret_keys, { env: ["__proto__"], headers: ["__proto__"] });
    assert.equal(Object.hasOwn(view?.env ?? {}, "__proto__"), true);
    assert.equal(Object.hasOwn(view?.headers ?? {}, "__proto__"), true);

    const maskedResponse = await post(view);
    const maskedText = await maskedResponse.text();
    assert.equal(maskedResponse.status, 200);
    assertNoSecrets(maskedText, envSentinel, headerSentinel);
    const stored = (await listConnectors())[0];
    assert.deepEqual(stored?.env, prototypeSecret(envSentinel));
    assert.deepEqual(stored?.headers, prototypeSecret(headerSentinel));
    const file = readFileSync(resolveConnectorsFilePath(), "utf8");
    assert.match(file, /"__proto__"/);
    assert.match(file, /route-prototype-env-sentinel/);
    assert.match(file, /route-prototype-header-sentinel/);
    assert.equal(file.includes(CONNECTOR_MASK_TOKEN), false);
  });
});
