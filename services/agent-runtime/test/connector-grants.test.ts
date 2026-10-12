import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "connector-grants-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;

const {
  EVERY_MODEL,
  listConnectorGrants,
  removeConnectorGrant,
  resolveConnectorGrantsFilePath,
  resolveGrantedTools,
  setConnectorGrant,
} = await import("../src/connector-grants");
const { resolveConnectorsFilePath } = await import("../src/connectors-service");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("connector access is granted per model", () => {
  beforeEach(() => {
    rmSync(resolveConnectorGrantsFilePath(), { force: true });
    writeFileSync(
      resolveConnectorsFilePath(),
      JSON.stringify({
        connectors: [
          { id: "notes", name: "Notes", transport: "stdio", command: "notes", enabled: true },
        ],
      }),
    );
  });

  test("enabling a connector grants every model, so nothing silently breaks", async () => {
    const grants = await listConnectorGrants();
    expect(grants).toHaveLength(1);
    expect(grants[0]?.modelId).toBe(EVERY_MODEL);
    expect(resolveGrantedTools(grants, "provider/model-a", "notes")).toBe("all");
  });

  test("a model-specific grant widens rather than narrows while the open grant stands", async () => {
    await listConnectorGrants();
    const grants = await setConnectorGrant({
      modelId: "provider/model-a",
      connectorId: "notes",
      tools: ["read_note"],
    });
    expect(resolveGrantedTools(grants, "provider/model-a", "notes")).toBe("all");
  });

  test("revoking the open grant leaves only the models named explicitly", async () => {
    await listConnectorGrants();
    await setConnectorGrant({
      modelId: "provider/model-a",
      connectorId: "notes",
      tools: ["read_note"],
    });
    const grants = await removeConnectorGrant(EVERY_MODEL, "notes");
    expect(resolveGrantedTools(grants, "provider/model-a", "notes")).toEqual(["read_note"]);
    expect(resolveGrantedTools(grants, "provider/model-b", "notes")).toEqual([]);
  });

  test("a revoked connector is not re-opened by the next read", async () => {
    await listConnectorGrants();
    await removeConnectorGrant(EVERY_MODEL, "notes");
    expect(await listConnectorGrants()).toHaveLength(0);
  });

  test("an empty tool list is stored as a revocation, not as an empty grant", async () => {
    await listConnectorGrants();
    await removeConnectorGrant(EVERY_MODEL, "notes");
    const grants = await setConnectorGrant({
      modelId: "provider/model-a",
      connectorId: "notes",
      tools: [],
    });
    expect(grants).toHaveLength(0);
  });
});
