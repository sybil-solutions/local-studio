// The renderer-embedded webview goes blank in many real-world scenarios
// (CSP, X-Frame-Options, oversized SPAs, captive portals, model-spawned
// errors). Rather than asking the user to debug, we always have a working
// "reading mode" that returns sanitized text + markdown via this endpoint.
//
// The route deliberately:
// - Refuses non-http(s) and private/loopback hosts (delegated to
//   sanitizePublicBrowserUrl) so we never get tricked into SSRF.
// - Strips scripts/styles/iframes from the HTML before extracting text.
// - Caps response size to 512KB to avoid runaway pages.

import { NextRequest, NextResponse } from "next/server";
import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Lightweight HTML → readable text. We intentionally avoid pulling in
// readability/cheerio dependencies here; the goal is "good enough for the
// model to read", not perfect rendering.
function htmlToReadable(html: string, baseUrl: string): { title: string; text: string } {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");
  const titleMatch = noScripts.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((titleMatch?.[1] ?? "").trim()) || baseUrl;
  const bodyMatch = noScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? noScripts;
  // Convert links to `[text](href)` so the model can follow them.
  const withLinks = body.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const text = decodeEntities(label.replace(/<[^>]+>/g, "").trim());
      const resolved = (() => {
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return href;
        }
      })();
      return text ? `[${text}](${resolved})` : resolved;
    },
  );
  // Block-level elements get a paragraph break for readability.
  const blocks = withLinks
    .replace(/<\/(p|h[1-6]|li|tr|div|article|section|header|footer)>/gi, "\n\n")
    .replace(/<br\s*\/?>(?!\s*<)/gi, "\n");
  const stripped = blocks.replace(/<[^>]+>/g, "");
  const text = decodeEntities(stripped)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
  return { title, text };
}

async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        chunks.push(value.slice(0, MAX_BYTES - (total - value.byteLength)));
        break;
      }
      chunks.push(value);
    }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  // Best-effort UTF-8; pages with exotic encodings may degrade but text-only
  // model consumption is forgiving.
  return buffer.toString("utf-8");
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const safe = sanitizePublicBrowserUrl(raw);
  if (!safe) {
    return NextResponse.json(
      { error: "url rejected (must be public http/https)" },
      { status: 400 },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safe, {
      headers: {
        // A boring user-agent avoids being served the bot-flag page that
        // breaks the embedded webview.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned HTTP ${response.status}`, status: response.status },
        { status: 502 },
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || safe;
    if (contentType.startsWith("text/plain") || contentType.includes("application/json")) {
      const text = (await readBoundedBody(response)).slice(0, MAX_BYTES);
      return NextResponse.json({ url: finalUrl, title: finalUrl, text, contentType });
    }
    if (contentType.startsWith("text/html") || contentType.includes("xhtml")) {
      const html = await readBoundedBody(response);
      const { title, text } = htmlToReadable(html, finalUrl);
      return NextResponse.json({ url: finalUrl, title, text, contentType });
    }
    return NextResponse.json({
      url: finalUrl,
      title: finalUrl,
      text: `Non-text response (${contentType || "unknown"}); not rendered.`,
      contentType,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fetch failed" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
