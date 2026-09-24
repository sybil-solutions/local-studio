//
// HTTP surface for the Google account: client credentials, connection status,
// disconnects, and the loopback OAuth authorization flow. Moved verbatim from
// the Next route handlers so a remote runtime owns the Google binding — the
// loopback OAuth listener must run in the process the connectors run in.
//

import { Effect, Schema } from "effect";
import {
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "../google-account";
import { closePooledConnection } from "../connector-pool";
import { listConnectors } from "../connectors-service";
import { disableGoogleWorkspaceAdapter } from "../google-workspace-adapter";
import {
  GOOGLE_ACCOUNT_KEY_PATTERN,
  googleWorkspaceConnectorIdentity,
} from "../google-workspace-binding";
import {
  beginGoogleLoopbackAuthorization,
  cancelGoogleLoopbackAuthorization,
  completeGoogleAuthorizationFromRedirect,
} from "../google-oauth-loopback";

const GoogleAuthorizeCompleteInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  url: Schema.String,
});

export async function handleGoogleAuthorizeComplete(request: Request): Promise<Response> {
  let input: typeof GoogleAuthorizeCompleteInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAuthorizeCompleteInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account and url are required" }, { status: 400 });
  }
  try {
    return Response.json(await completeGoogleAuthorizationFromRedirect(input.account, input.url));
  } catch (error) {
    return failure(error, "Google sign-in failed");
  }
}

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});

const GoogleDisconnectInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  accountKey: Schema.String,
});

const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

function failure(error: unknown, fallback = "Google account failed"): Response {
  const status = error instanceof GoogleAccountError ? error.status : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status },
  );
}

/** Pooled sockets outlive a credential change, so every managed row is dropped. */
async function closeGoogleConnections(): Promise<void> {
  try {
    for (const connector of await listConnectors()) {
      if (googleWorkspaceConnectorIdentity(connector.id)) closePooledConnection(connector.id);
    }
  } catch {
    // A connector file we cannot read has no live pooled connections to close.
  }
}

export async function handleGoogleAccountGet(): Promise<Response> {
  try {
    return Response.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleGoogleClientPut(request: Request): Promise<Response> {
  let input: typeof GoogleClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleClientInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "clientId must be a string" }, { status: 400 });
  }
  try {
    const account = await Effect.runPromise(saveGoogleClient(input));
    return Response.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

export async function handleGoogleAccountDisconnect(request: Request): Promise<Response> {
  let input: typeof GoogleDisconnectInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleDisconnectInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account and accountKey are required" }, { status: 400 });
  }
  if (!GOOGLE_ACCOUNT_KEY_PATTERN.test(input.accountKey)) {
    return Response.json({ error: "accountKey is not a known account" }, { status: 400 });
  }
  const identity = { service: input.account, accountKey: input.accountKey };
  try {
    const account = await Effect.runPromise(
      Effect.gen(function* () {
        const disconnected = yield* disconnectGoogleAccount(identity);
        yield* disableGoogleWorkspaceAdapter(identity).pipe(
          Effect.mapError((error) => new GoogleAccountError(500, error.message)),
        );
        return disconnected;
      }),
    );
    return Response.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

export async function handleGoogleAuthorizeBegin(request: Request): Promise<Response> {
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account is required" }, { status: 400 });
  }
  try {
    return Response.json(
      await Effect.runPromise(beginGoogleLoopbackAuthorization(input.account)),
    );
  } catch (error) {
    return failure(error, "Google sign-in failed");
  }
}

export async function handleGoogleAuthorizeCancel(request: Request): Promise<Response> {
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account is required" }, { status: 400 });
  }
  try {
    await Effect.runPromise(cancelGoogleLoopbackAuthorization(input.account));
    return Response.json({ cancelled: true });
  } catch (error) {
    return failure(error, "Google sign-in cancellation failed");
  }
}
