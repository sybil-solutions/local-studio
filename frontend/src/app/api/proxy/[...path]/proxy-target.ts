import { NextResponse, type NextRequest } from "next/server";
import { getApiSettings } from "@local-studio/agent-runtime/settings-service";
import type { ClientInfo } from "./proxy-logging";

const OVERRIDE_ALLOWLIST_ENV_KEY = "LOCAL_STUDIO_PROXY_OVERRIDE_ALLOWLIST";
const BACKEND_OVERRIDE_COOKIE = "localstudio_backend_url";
const LEGACY_BACKEND_OVERRIDE_COOKIE = [["v", "llmstudio"].join(""), "backend_url"].join("_");
const CLEAR_BACKEND_OVERRIDE_COOKIE = `${BACKEND_OVERRIDE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
const CLEAR_LEGACY_BACKEND_OVERRIDE_COOKIE = `${LEGACY_BACKEND_OVERRIDE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;

export type ProxyTargetResolution =
  | {
      apiKey: string;
      backendUrl: string;
      blockedOverrideCleared: boolean;
      defaultBackendUrl: string;
      overrideUrl: string | null;
      strictOverride: boolean;
    }
  | { blockedResponse: NextResponse };

function normalizeBackendUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getTrustedOverrideOrigins(defaultBackendUrl: string): Set<string> {
  const trusted = new Set<string>();

  const defaultOrigin = normalizeOrigin(defaultBackendUrl);
  if (defaultOrigin) {
    trusted.add(defaultOrigin);
  }

  const rawAllowlist = process.env[OVERRIDE_ALLOWLIST_ENV_KEY] ?? "";
  for (const entry of rawAllowlist.split(",")) {
    const normalized = normalizeBackendUrl(entry.trim());
    const origin = normalizeOrigin(normalized);
    if (origin) {
      trusted.add(origin);
    }
  }

  return trusted;
}

function isTrustedOverride(urlString: string, defaultBackendUrl: string): boolean {
  if (process.env.LOCAL_STUDIO_DESKTOP === "1") return true;

  const targetOrigin = normalizeOrigin(urlString);
  if (!targetOrigin) return false;
  const trusted = getTrustedOverrideOrigins(defaultBackendUrl);
  return trusted.has(targetOrigin);
}

export function clearBackendOverrideHeaders(): Record<string, string> {
  return {
    "X-Backend-Override-Invalid": "1",
    "Set-Cookie": `${CLEAR_BACKEND_OVERRIDE_COOKIE}, ${CLEAR_LEGACY_BACKEND_OVERRIDE_COOKIE}`,
  };
}

function blockedHeaderOverrideResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Backend override blocked: private/local addresses must be allowlisted via LOCAL_STUDIO_PROXY_OVERRIDE_ALLOWLIST",
    },
    {
      status: 403,
      headers: clearBackendOverrideHeaders(),
    },
  );
}

export async function resolveProxyTarget(
  request: NextRequest,
  client: Pick<ClientInfo, "ip">,
): Promise<ProxyTargetResolution> {
  const settings = await getApiSettings();
  const overrideHeaderUrl = normalizeBackendUrl(request.headers.get("x-backend-url"));
  const strictOverride = request.headers.get("x-backend-strict") === "1";
  const overrideCookieUrl = normalizeBackendUrl(
    request.cookies.get(BACKEND_OVERRIDE_COOKIE)?.value ??
      request.cookies.get(LEGACY_BACKEND_OVERRIDE_COOKIE)?.value ??
      null,
  );
  const defaultBackendUrl = normalizeBackendUrl(settings.backendUrl) ?? settings.backendUrl;
  let overrideUrl = overrideHeaderUrl ?? overrideCookieUrl;

  if (overrideUrl && !isTrustedOverride(overrideUrl, defaultBackendUrl)) {
    if (overrideHeaderUrl) {
      console.warn(
        `[PROXY BLOCKED] ip=${client.ip} | override=redacted | reason=origin-not-allowlisted`,
      );
      return { blockedResponse: blockedHeaderOverrideResponse() };
    }
    console.warn(
      `[PROXY OVERRIDE IGNORED] ip=${client.ip} | override=redacted | reason=origin-not-allowlisted`,
    );
    overrideUrl = null;
    return {
      apiKey: settings.apiKey,
      backendUrl: defaultBackendUrl,
      blockedOverrideCleared: true,
      defaultBackendUrl,
      overrideUrl,
      strictOverride,
    };
  }

  return {
    apiKey: settings.apiKey,
    backendUrl: overrideUrl ?? defaultBackendUrl,
    blockedOverrideCleared: false,
    defaultBackendUrl,
    overrideUrl,
    strictOverride,
  };
}
