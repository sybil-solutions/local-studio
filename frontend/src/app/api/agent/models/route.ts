import { NextResponse } from "next/server";
import { refreshPiModels } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
