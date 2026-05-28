import { NextResponse } from "next/server";
import { discoverPromptTemplates } from "@/lib/agent/prompt-templates-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ templates: discoverPromptTemplates() });
}
