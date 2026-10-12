//
// HTTP surface for click-to-connect OAuth on catalog connectors. The routes
// are deliberately generic — the connector id selects a provider definition,
// the engine picks the flow — so adding a provider is a registry entry, not a
// new endpoint. Tokens never travel through these responses: status reports
// who is connected, authorize reports what the user must click, and that is
// the entire vocabulary.
//

import { Schema } from "effect";
import {
  OAuthClientInputSchema,
  OAuthConnectorInputSchema,
  OAuthTokenInputSchema,
} from "../oauth-connector-contract";
import {
  beginOAuthConnectorAuthorization,
  cancelOAuthConnectorAuthorization,
  disconnectOAuthConnector,
  getOAuthConnectorStatus,
  OAuthConnectorError,
  saveOAuthConnectorClient,
  saveOAuthConnectorToken,
} from "../oauth-connectors";
import { closePooledConnection } from "../connector-pool";

function failure(error: unknown, fallback: string): Response {
  const status = error instanceof OAuthConnectorError ? error.status : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status },
  );
}

async function connectorIdFromBody(request: Request): Promise<string | null> {
  try {
    const input = Schema.decodeUnknownSync(OAuthConnectorInputSchema)(await request.json());
    return input.connectorId.trim() || null;
  } catch {
    return null;
  }
}

export async function handleOAuthAuthorizeBegin(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    return Response.json(await beginOAuthConnectorAuthorization(connectorId));
  } catch (error) {
    return failure(error, "OAuth sign-in failed");
  }
}

export async function handleOAuthAuthorizeCancel(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    cancelOAuthConnectorAuthorization(connectorId);
    return Response.json({ cancelled: true });
  } catch (error) {
    return failure(error, "OAuth cancellation failed");
  }
}

export async function handleOAuthStatus(request: Request): Promise<Response> {
  const connectorId = new URL(request.url).searchParams.get("connectorId")?.trim();
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    return Response.json(await getOAuthConnectorStatus(connectorId));
  } catch (error) {
    return failure(error, "OAuth status failed");
  }
}

export async function handleOAuthClientPut(request: Request): Promise<Response> {
  let input: typeof OAuthClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(OAuthClientInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "connectorId and clientId are required" }, { status: 400 });
  }
  try {
    await saveOAuthConnectorClient(input.connectorId.trim(), input.clientId);
    return Response.json(await getOAuthConnectorStatus(input.connectorId.trim()));
  } catch (error) {
    return failure(error, "OAuth client could not be saved");
  }
}

export async function handleOAuthTokenPut(request: Request): Promise<Response> {
  let input: typeof OAuthTokenInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(OAuthTokenInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "connectorId and token are required" }, { status: 400 });
  }
  try {
    const status = await saveOAuthConnectorToken(input.connectorId.trim(), input.token);
    // A pooled child spawned with the old token keeps running otherwise.
    closePooledConnection(input.connectorId.trim());
    return Response.json(status);
  } catch (error) {
    return failure(error, "The token could not be saved");
  }
}

export async function handleOAuthDisconnect(request: Request): Promise<Response> {
  const connectorId = new URL(request.url).searchParams.get("connectorId")?.trim();
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    const status = await disconnectOAuthConnector(connectorId);
    // A pooled child spawned with the old token keeps running otherwise.
    closePooledConnection(connectorId);
    return Response.json(status);
  } catch (error) {
    return failure(error, "OAuth disconnect failed");
  }
}
