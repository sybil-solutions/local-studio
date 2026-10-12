//
// HTTP surface for MCP connectors: the CRUD listing, the granted-tool
// inventory + tool calls, the per-model grants, the probe ("test") endpoint,
// and the bundled ssh server path. Moved verbatim from the Next route
// handlers so a remote runtime owns connector state instead of the frontend
// process that happens to serve the UI.
//

import { Schema } from "effect";
import {
  ConnectorTestInputSchema,
  ConnectorUpsertInputSchema,
} from "../connector-contract";
import {
  connectorToolPrefix,
  enabledConnectors,
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "../connectors-service";
import {
  callConnectorTool,
  closePooledConnection,
  ConnectorToolDeniedError,
  listConnectorTools,
  probeConnector,
} from "../connector-pool";
import {
  isConnectorToolGranted,
  listConnectorGrants,
  removeConnectorGrant,
  resolveGrantedTools,
  setConnectorGrant,
} from "../connector-grants";
import {
  ConnectorGrantInputSchema,
  ConnectorGrantRemovalSchema,
  type ConnectorGrantTarget,
} from "../connector-grants-contract";
import { resolveBundledResource } from "../plugin-resources";

export async function handleConnectorsList(): Promise<Response> {
  const connectors = await listConnectors();
  return Response.json({ connectors: connectors.map(toConnectorView) });
}

/**
 * Everything a submitted connector can be refused for, in one place.
 *
 * A connector row names a command to execute or an endpoint to trust, so the
 * server checks it rather than relying on the form that happened to submit it —
 * this route is reachable by anything that can reach loopback, including the
 * agent's own tools.
 */
async function rejectionFor(
  body: typeof ConnectorUpsertInputSchema.Type,
): Promise<Response | null> {
  const reject = (error: string, status: number) => Response.json({ error }, { status });
  if (!isValidConnectorId(body.id)) return reject("invalid connector id", 400);
  if (body.transport === "stdio" && !body.command) {
    return reject("command is required for stdio", 400);
  }
  if (body.transport === "http") {
    if (!body.url) return reject("url is required for http", 400);
    // An MCP endpoint is fetched by this process with whatever headers the row
    // carries, so the scheme is worth pinning: `file:` would read local paths
    // and the exotic schemes are not something a user meant to type.
    if (!/^https?:\/\//i.test(body.url)) {
      return reject("url must start with http:// or https://", 400);
    }
  }
  // Tool names are namespaced `<id with - as _>_<tool>`, so `a-b` and `a_b`
  // would offer the model two different servers under one name and the second
  // registration would quietly win. Ids are compared on that derived prefix
  // rather than literally, and only against *other* rows so a row can always be
  // saved over itself.
  const collision = (await listConnectors()).find(
    (entry) =>
      entry.id !== body.id && connectorToolPrefix(entry.id) === connectorToolPrefix(body.id),
  );
  return collision
    ? reject(`Tool names would collide with connector "${collision.id}"`, 409)
    : null;
}

export async function handleConnectorUpsert(request: Request): Promise<Response> {
  let body: typeof ConnectorUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorUpsertInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "invalid connector payload" }, { status: 400 });
  }
  const rejection = await rejectionFor(body);
  if (rejection) return rejection;
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.envSecret ? { envSecret: body.envSecret } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.headerSecret ? { headerSecret: body.headerSecret } : {}),
    // Three states, not two. Absent means "leave the allow list alone" — what
    // every caller that only meant to flip `enabled` sends. An empty list means
    // "clear it, allow every tool this server declares", which is the widening
    // an authoring UI has to be able to express and could not before. A
    // populated list is the restriction itself.
    ...(body.allowTools === undefined
      ? {}
      : { allowTools: body.allowTools.length > 0 ? body.allowTools : undefined }),
    enabled: body.enabled ?? true,
  };
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: 409 },
    );
  }
}

export async function handleConnectorDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}

const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model_id: Schema.optional(Schema.String),
});

/**
 * The session's model, as claimed by the caller. It decides which connector
 * tools are offered and which calls are allowed. An unnamed model matches only
 * the `*` grants, so an older extension that does not send one keeps whatever
 * blanket access the user left in place and gains nothing else.
 */
const callerModelId = (value: string | null | undefined): string => value?.trim() ?? "";

export async function handleConnectorInventory(request: Request): Promise<Response> {
  const modelId = callerModelId(new URL(request.url).searchParams.get("model_id"));
  const grants = await listConnectorGrants();
  const granted = (await enabledConnectors()).flatMap((connector) => {
    const tools = resolveGrantedTools(grants, modelId, connector.id);
    return tools === "all" || tools.length ? [{ connector, tools }] : [];
  });
  const inventory = await Promise.all(
    granted.map(async ({ connector, tools }) => {
      try {
        const available = await listConnectorTools(connector.id);
        return {
          id: connector.id,
          name: connector.name,
          tools:
            tools === "all" ? available : available.filter((tool) => tools.includes(tool.name)),
        };
      } catch (error) {
        return {
          id: connector.id,
          name: connector.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return Response.json({ connectors: inventory });
}

export async function handleConnectorCall(request: Request): Promise<Response> {
  let body: typeof ConnectorToolCallSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorToolCallSchema)(await request.json());
  } catch {
    return Response.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  if (!body.connector_id.trim() || !body.tool.trim()) {
    return Response.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  try {
    // Filtering the inventory only decides what the model is told about; the
    // grant is re-checked here because this route is the actual boundary.
    const grants = await listConnectorGrants();
    if (
      !isConnectorToolGranted(grants, callerModelId(body.model_id), body.connector_id, body.tool)
    ) {
      throw new ConnectorToolDeniedError(
        `Model is not granted "${body.tool}" on connector "${body.connector_id}"`,
      );
    }
    const result = await callConnectorTool(body.connector_id, body.tool, body.args ?? {});
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

function grantsFailure(error: unknown, fallback: string): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

/**
 * The grant targets.
 *
 * Probing a connector for its tool names OPENS it, and opening a stdio MCP
 * connector spawns its child process. Doing that for every enabled connector
 * just to render a list meant merely viewing this page executed every MCP
 * server the user had configured — so the probe is scoped to the one connector
 * being edited, and the list itself launches nothing.
 *
 * A connector that cannot be reached still has to be listable, so a failed
 * probe degrades to an empty tool list rather than failing the request.
 */
async function grantTargets(probeId: string | null): Promise<ConnectorGrantTarget[]> {
  return Promise.all(
    (await enabledConnectors()).map(async (connector) => {
      const tools =
        probeId === connector.id ? await listConnectorTools(connector.id).catch(() => []) : [];
      return {
        id: connector.id,
        name: connector.name,
        tools: tools.map((tool) => tool.name),
      };
    }),
  );
}

export async function handleConnectorGrantsGet(request: Request): Promise<Response> {
  try {
    // ?connector=<id> asks for that connector's tool names; without it the
    // list is metadata only and nothing is executed.
    const probeId = new URL(request.url).searchParams.get("connector")?.trim() || null;
    const [grants, connectors] = await Promise.all([listConnectorGrants(), grantTargets(probeId)]);
    return Response.json({ grants, connectors });
  } catch (error) {
    return grantsFailure(error, "Connector grants failed");
  }
}

export async function handleConnectorGrantPut(request: Request): Promise<Response> {
  let input: typeof ConnectorGrantInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantInputSchema)(await request.json());
  } catch {
    return Response.json(
      { error: "modelId, connectorId and tools are required" },
      { status: 400 },
    );
  }
  if (!input.modelId.trim() || !input.connectorId.trim()) {
    return Response.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return Response.json({ grants: await setConnectorGrant(input) });
  } catch (error) {
    return grantsFailure(error, "Connector grant could not be saved");
  }
}

export async function handleConnectorGrantDelete(request: Request): Promise<Response> {
  let input: typeof ConnectorGrantRemovalSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantRemovalSchema)(await request.json());
  } catch {
    return Response.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return Response.json({
      grants: await removeConnectorGrant(input.modelId, input.connectorId),
    });
  } catch (error) {
    return grantsFailure(error, "Connector grant could not be removed");
  }
}

export async function handleConnectorTest(request: Request): Promise<Response> {
  let body: typeof ConnectorTestInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorTestInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return Response.json({ error: "unknown connector" }, { status: 404 });
  const result = await probeConnector(connector);
  return Response.json({
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
    ...(result.error ? { error: result.error } : {}),
  });
}

export async function handleSshServerPath(): Promise<Response> {
  // Bundled stdio MCP servers live at desktop/resources/mcp — same ladder as extensions.
  return Response.json({ path: resolveBundledResource("mcp", "ssh-remote.mjs") });
}
