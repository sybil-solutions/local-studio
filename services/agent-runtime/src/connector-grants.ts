import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { atomicWriteJson, resolveDataDir } from "./data-dir";
import { enabledConnectors } from "./connectors-service";
import {
  ConnectorGrantsFileSchema,
  EVERY_MODEL,
  type ConnectorGrant,
  type ConnectorGrantInput,
} from "./connector-grants-contract";

export {
  EVERY_MODEL,
  type ConnectorGrant,
  type ConnectorGrantInput,
} from "./connector-grants-contract";

/**
 * Which models may reach which connector tools.
 *
 * The rule is deny-by-default: a model with no matching grant sees no connector
 * tools at all. Enabling a connector writes its opening grant (`*`, every
 * tool), so turning one on behaves exactly as it did before this file existed;
 * narrowing it to specific models, or to specific tools, is then a subtraction
 * the user makes on purpose.
 *
 * The model id is asserted by the caller, not proven. This governs what the
 * model is offered and what it is allowed to invoke — it is not a sandbox
 * against arbitrary local code, which can reach the same loopback route.
 */
type GrantsFile = typeof ConnectorGrantsFileSchema.Type;

let grantsAccess = Promise.resolve();

function withGrantsAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = grantsAccess.then(operation);
  grantsAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function resolveConnectorGrantsFilePath(): string {
  return join(resolveDataDir(), "connector-grants.json");
}

function emptyGrants(): GrantsFile {
  return { version: 1, seeded: [], grants: [] };
}

async function readGrantsFile(): Promise<GrantsFile> {
  const file = resolveConnectorGrantsFilePath();
  if (!existsSync(file)) return emptyGrants();
  try {
    return Schema.decodeUnknownSync(ConnectorGrantsFileSchema)(
      JSON.parse(await readFile(file, "utf-8")),
    );
  } catch {
    throw new Error("Connector grant configuration is invalid");
  }
}

function writeGrantsFile(grants: GrantsFile): Promise<void> {
  return atomicWriteJson(resolveConnectorGrantsFilePath(), grants, { mode: 0o600 });
}

/**
 * Gives every newly enabled connector its opening `*` grant exactly once, so
 * deny-by-default never silently disarms a connector the user just turned on.
 */
async function seededGrants(): Promise<GrantsFile> {
  const stored = await readGrantsFile();
  const seeded = new Set(stored.seeded);
  const pending = (await enabledConnectors())
    .map((connector) => connector.id)
    .filter((id) => !seeded.has(id));
  if (!pending.length) return stored;
  const createdAt = new Date().toISOString();
  const next: GrantsFile = {
    version: 1,
    seeded: [...seeded, ...pending],
    grants: [
      ...stored.grants,
      ...pending.map((connectorId) => ({
        modelId: EVERY_MODEL,
        connectorId,
        tools: "all" as const,
        createdAt,
      })),
    ],
  };
  await writeGrantsFile(next);
  return next;
}

export function listConnectorGrants(): Promise<ConnectorGrant[]> {
  return withGrantsAccess(async () => [...(await seededGrants()).grants]);
}

export function setConnectorGrant(input: ConnectorGrantInput): Promise<ConnectorGrant[]> {
  return withGrantsAccess(async () => {
    const stored = await seededGrants();
    const tools = input.tools === "all" ? "all" : [...new Set(input.tools)].sort();
    const grant: ConnectorGrant = {
      modelId: input.modelId,
      connectorId: input.connectorId,
      tools,
      createdAt: new Date().toISOString(),
    };
    const grants = stored.grants.filter(
      (entry) => entry.modelId !== grant.modelId || entry.connectorId !== grant.connectorId,
    );
    // An empty tool list is a revocation, not a grant of nothing: storing it
    // would leave a row that reads as "allowed" in every listing.
    const next = tools === "all" || tools.length ? [...grants, grant] : grants;
    await writeGrantsFile({ ...stored, grants: next });
    return next;
  });
}

export function removeConnectorGrant(
  modelId: string,
  connectorId: string,
): Promise<ConnectorGrant[]> {
  return withGrantsAccess(async () => {
    const stored = await seededGrants();
    const grants = stored.grants.filter(
      (entry) => entry.modelId !== modelId || entry.connectorId !== connectorId,
    );
    await writeGrantsFile({ ...stored, grants });
    return grants;
  });
}

/**
 * The tools `modelId` may call on `connectorId`: `"all"`, an explicit list, or
 * an empty list when nothing is granted. A `*` row and a model-specific row are
 * unioned, so a broad grant is never narrowed by adding a second one.
 */
export function resolveGrantedTools(
  grants: ConnectorGrant[],
  modelId: string,
  connectorId: string,
): "all" | string[] {
  const matching = grants.filter(
    (grant) =>
      grant.connectorId === connectorId &&
      (grant.modelId === EVERY_MODEL || grant.modelId === modelId),
  );
  if (matching.some((grant) => grant.tools === "all")) return "all";
  return [...new Set(matching.flatMap((grant) => (grant.tools === "all" ? [] : grant.tools)))];
}

export function isConnectorToolGranted(
  grants: ConnectorGrant[],
  modelId: string,
  connectorId: string,
  tool: string,
): boolean {
  const granted = resolveGrantedTools(grants, modelId, connectorId);
  return granted === "all" || granted.includes(tool);
}
