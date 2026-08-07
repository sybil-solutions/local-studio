import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { PluginRuntimeError, setPluginEnabled } from "@local-studio/agent-runtime/plugin-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PluginActivationSchema = Schema.Struct({ enabled: Schema.Boolean });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof PluginActivationSchema.Type;
  try {
    body = Schema.decodeUnknownSync(PluginActivationSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const result = await Effect.runPromise(setPluginEnabled(id, body.enabled));
    return NextResponse.json({ plugins: result.plugins });
  } catch (error) {
    const status = error instanceof PluginRuntimeError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plugin activation failed" },
      { status },
    );
  }
}
