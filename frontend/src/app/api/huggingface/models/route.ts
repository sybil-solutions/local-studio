import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_MODELS = "https://huggingface.co/api/models";
const TIMEOUT_MS = 12_000;
const ALLOWED_PARAMS = new Set([
  "author",
  "filter",
  "full",
  "library",
  "limit",
  "offset",
  "search",
  "sort",
]);

export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const target = new URL(HF_MODELS);
  for (const [key, value] of source.searchParams) {
    if (ALLOWED_PARAMS.has(key) && value.trim()) target.searchParams.append(key, value);
  }
  if (!target.searchParams.has("limit")) target.searchParams.set("limit", "50");
  if (!target.searchParams.has("full")) target.searchParams.set("full", "false");

  try {
    const response = await fetchWithTimeout(target.toString(), {
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Hugging Face returned ${response.status}.`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Hugging Face models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
