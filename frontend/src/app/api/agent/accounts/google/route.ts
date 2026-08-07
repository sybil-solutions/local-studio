import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "@local-studio/agent-runtime/google-account";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { disableGoogleWorkspaceAdapter } from "@local-studio/agent-runtime/google-workspace-adapter";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
} from "@local-studio/agent-runtime/google-workspace-binding";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});

const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

function failure(error: unknown) {
  const status = error instanceof GoogleAccountError ? error.status : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Google account failed" },
    { status },
  );
}

async function closeGoogleConnections(): Promise<void> {
  await Promise.all(
    GOOGLE_WORKSPACE_PLUGIN_IDS.map((id) =>
      closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId),
    ),
  );
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleClientInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "clientId must be a string" }, { status: 400 });
  }
  try {
    const account = await Effect.runPromise(saveGoogleClient(input));
    return NextResponse.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  try {
    const account = await Effect.runPromise(
      Effect.gen(function* () {
        const disconnected = yield* disconnectGoogleAccount(input.account);
        yield* disableGoogleWorkspaceAdapter(input.account).pipe(
          Effect.mapError((error) => new GoogleAccountError(500, error.message)),
        );
        return disconnected;
      }),
    );
    return NextResponse.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}
