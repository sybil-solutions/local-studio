import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF = "https://huggingface.co/api";
const TIMEOUT_MS = 8_000;

// In-process avatar cache. Avatars are stable (HF CDN URLs don't change for a
// given owner), so we cache the resolved URL for CACHE_TTL and remember misses
// for MISS_TTL so we don't hammer HF with two sequential API calls on every
// page render for an owner that has no avatar.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — avatar URLs are stable
const MISS_TTL_MS = 30 * 60 * 1000; // 30m — retry misses sooner in case HF was down
const cache = new Map<string, { url: string | null; expires: number }>();

async function resolveAvatarUrl(owner: string): Promise<string | null> {
  const cached = cache.get(owner);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.url;

  let url: string | null = null;
  for (const kind of ["organizations", "users"] as const) {
    try {
      const response = await fetchWithTimeout(
        `${HF}/${kind}/${encodeURIComponent(owner)}/overview`,
        { headers: { accept: "application/json" } },
        TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const data = (await response.json()) as { avatarUrl?: unknown };
      if (typeof data.avatarUrl === "string" && data.avatarUrl.startsWith("https://")) {
        url = data.avatarUrl;
        break;
      }
    } catch {
      // network blip — try the next kind
    }
  }

  cache.set(owner, {
    url,
    expires: now + (url ? CACHE_TTL_MS : MISS_TTL_MS),
  });
  return url;
}

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(owner)) {
    return NextResponse.json({ error: "Invalid owner." }, { status: 400 });
  }

  const avatarUrl = await resolveAvatarUrl(owner);
  if (!avatarUrl) return NextResponse.json({ error: "Avatar not found." }, { status: 404 });

  // Proxy the image bytes rather than 307-redirecting. In the Electron desktop
  // context, a cross-origin redirect to cdn-avatars.huggingface.co can be
  // blocked by the renderer's network policy / CSP, so every avatar silently
  // 404s and ModelLogo falls back to the placeholder. Proxying keeps the
  // <img> request on the same origin ('self').
  try {
    const imgResponse = await fetchWithTimeout(
      avatarUrl,
      { headers: { accept: "image/*" } },
      TIMEOUT_MS,
    );
    if (!imgResponse.ok)
      return NextResponse.json({ error: "Avatar fetch failed." }, { status: 502 });
    const contentType = imgResponse.headers.get("content-type") ?? "image/png";
    const arrayBuffer = await imgResponse.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Avatar fetch failed." }, { status: 502 });
  }
}
