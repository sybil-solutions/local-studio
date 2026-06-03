import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF = "https://huggingface.co/api";
const TIMEOUT_MS = 8_000;

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(owner)) {
    return NextResponse.json({ error: "Invalid owner." }, { status: 400 });
  }

  const avatarUrl = await resolveAvatarUrl(owner);
  if (!avatarUrl) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });
  return NextResponse.redirect(avatarUrl, {
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

async function resolveAvatarUrl(owner: string): Promise<string | null> {
  for (const kind of ["organizations", "users"]) {
    const response = await fetchWithTimeout(`${HF}/${kind}/${encodeURIComponent(owner)}/overview`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) continue;
    const data = (await response.json()) as { avatarUrl?: unknown };
    if (typeof data.avatarUrl === "string" && data.avatarUrl.startsWith("https://")) {
      return data.avatarUrl;
    }
  }
  return null;
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
