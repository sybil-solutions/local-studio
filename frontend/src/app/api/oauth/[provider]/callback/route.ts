import { NextRequest } from "next/server";
import { exchangeOAuthCode } from "@/features/agent/oauth/oauth-store";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";
import { installManagedOAuthCatalogueServer } from "@/features/agent/mcp/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "oauth_state";
const PROVIDER_COOKIE = "oauth_provider";
const INSTALL_CATALOGUE_COOKIE = "oauth_install_catalogue_id";

function htmlPage(title: string, detail: string, status = 200): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#e7e7ea;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.1rem;margin:0 0 .5rem}p{color:#a1a1aa;font-size:.9rem;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${detail}</p><script>setTimeout(function(){window.close()},1500)</script></main></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const def = getOAuthProvider(provider);
  if (!def) {
    return htmlPage("Authorization failed", "Unknown OAuth provider.", 404);
  }

  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return htmlPage("Authorization failed", `${def.displayName} returned: ${error}`, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const cookieProvider = request.cookies.get(PROVIDER_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState || cookieProvider !== provider) {
    return htmlPage(
      "Authorization failed",
      "Invalid or expired OAuth state. Please try again.",
      400,
    );
  }

  const redirectUri = `${url.origin}/api/oauth/${provider}/callback`;
  try {
    await exchangeOAuthCode(provider, code, redirectUri);
  } catch (exchangeError) {
    const message =
      exchangeError instanceof Error ? exchangeError.message : "Token exchange failed.";
    return htmlPage("Authorization failed", message, 500);
  }

  const catalogueId = request.cookies.get(INSTALL_CATALOGUE_COOKIE)?.value;
  if (catalogueId) {
    const install = installManagedOAuthCatalogueServer(catalogueId);
    if (install.status !== 200) {
      const errorMessage =
        "error" in install.payload && typeof install.payload.error === "string"
          ? install.payload.error
          : `${def.displayName} connected, but plugin install failed.`;
      return htmlPage(`${def.displayName} connected`, errorMessage, 500);
    }
  }

  return htmlPage(
    catalogueId
      ? `${def.displayName} connected · plugin installed`
      : `${def.displayName} connected`,
    catalogueId
      ? `Local Studio connected ${def.displayName} and installed the managed MCP server. You can close this tab.`
      : `Local Studio now has a refreshable ${def.displayName} token. You can close this tab.`,
  );
}
