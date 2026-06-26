import { NextResponse } from "next/server";
import {
  refreshPiModels,
  type PiControllerModelsRequest,
} from "@/features/agent/pi-runtime-models";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseControllers(value: unknown): PiControllerModelsRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string" || !record.url.trim()) return [];
    return [
      {
        url: record.url,
        ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    ];
  });
}

export async function GET() {
  try {
    const { models } = await refreshPiModels();
    return NextResponse.json({ provider: "local-studio", models });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to load /v1/models"), 502);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const controllers = parseControllers(body.controllers);
    const { models } = await refreshPiModels(controllers);
    return NextResponse.json({ provider: "local-studio", models });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to load /v1/models"), 502);
  }
}
