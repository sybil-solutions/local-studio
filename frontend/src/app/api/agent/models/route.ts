import { NextResponse } from "next/server";
import { refreshPiModels } from "@/lib/agent/pi-runtime";
import type { PiControllerModelsRequest } from "@/lib/agent/pi-runtime-models";

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
    return NextResponse.json({ provider: "vllm-studio", models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load /v1/models" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const controllers = parseControllers(body.controllers);
    const { models } = await refreshPiModels(controllers);
    return NextResponse.json({ provider: "vllm-studio", models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load /v1/models" },
      { status: 502 },
    );
  }
}
