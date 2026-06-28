import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/features/agent/oauth/oauth-store";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "oauth_state";
const PROVIDER_COOKIE = "oauth_provider";
const INSTALL_CATALOGUE_COOKIE = "oauth_install_catalogue_id";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setupPage(displayName: string, redirectUri: string, message: string): NextResponse {
  const title = `${displayName} OAuth setup required`;
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0c;color:#e7e7ea;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}main{max-width:40rem;padding:2rem}h1{font-size:1.1rem;margin:0 0 .75rem}p,li{color:#a1a1aa;font-size:.9rem;line-height:1.55}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#e7e7ea;background:#18181b;border:1px solid #27272a;border-radius:.35rem;padding:.1rem .3rem}ol{padding-left:1.2rem}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><ol><li>Open Settings → Plugins → Connections.</li><li>Save the ${escapeHtml(displayName)} OAuth client ID and secret.</li><li>Use this redirect URI in the OAuth app: <code>${escapeHtml(redirectUri)}</code></li><li>Click Connect again to open the browser login.</li></ol></main></body></html>`;
  return new NextResponse(body, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const definition = getOAuthProvider(provider);
  if (!definition) {
    return new NextResponse("Unknown OAuth provider.", { status: 404 });
  }
  const redirectUri = `${request.nextUrl.origin}/api/oauth/${provider}/callback`;
  const state = randomUUID();
  const catalogueId = request.nextUrl.searchParams.get("catalogueId")?.trim();
  let authUrl: string;
  try {
    authUrl = await buildAuthUrl(provider, redirectUri, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot start OAuth.";
    return setupPage(definition.displayName, redirectUri, message);
  }
  const response = NextResponse.redirect(authUrl);
  const secure = request.nextUrl.protocol === "https:";
  const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  response.cookies.set(STATE_COOKIE, state, cookieBase);
  response.cookies.set(PROVIDER_COOKIE, provider, cookieBase);
  if (catalogueId) {
    response.cookies.set(INSTALL_CATALOGUE_COOKIE, catalogueId, cookieBase);
  }
  return response;
}
