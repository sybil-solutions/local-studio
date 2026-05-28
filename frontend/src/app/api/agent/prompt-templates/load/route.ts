import { NextRequest, NextResponse } from "next/server";
import { loadPromptTemplateInstructions } from "@/lib/agent/prompt-templates-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const templatePath = request.nextUrl.searchParams.get("path") ?? "";
  const template = templatePath ? loadPromptTemplateInstructions(templatePath) : null;
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template });
}
