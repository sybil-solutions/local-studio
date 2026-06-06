// The renderer-embedded webview goes blank in many real-world scenarios
// (CSP, X-Frame-Options, oversized SPAs, captive portals, model-spawned
// errors). Rather than asking the user to debug, we keep a working "reading
// mode" that returns sanitized text + markdown via this endpoint.
//
// The route deliberately:
// - Refuses non-http(s) and private/loopback hosts (delegated to
//   sanitizePublicBrowserUrl) so we never get tricked into SSRF.
// - Strips scripts/styles/iframes from the HTML before extracting text.
// - Caps response size to 512KB to avoid runaway pages.
// - Uses Node http/https with a vetted lookup address so the desktop embedded
//   server does not shell out, hang on slow upstreams, or rebind after DNS.

import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

type ResolvedHostAddress = {
  address: string;
  family: 4 | 6;
};
type ResolvedHostInput = string | ResolvedHostAddress;
type ReaderHostResolver = (hostname: string) => Promise<ResolvedHostInput[]>;

declare global {
  // Test-only hook for simulating DNS answers without adding non-route exports.
  var __VLLM_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST: ReaderHostResolver | undefined;
  var __VLLM_STUDIO_BROWSER_READER_REQUEST_FOR_TEST:
    | ((url: string, address: ResolvedHostAddress) => Promise<BoundedResponse>)
    | undefined;
}

async function resolveReaderHost(hostname: string): Promise<ResolvedHostAddress[]> {
  const testResolver = globalThis.__VLLM_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
  if (testResolver) return (await testResolver(hostname)).map(normalizeResolvedAddress);
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
}

type BoundedResponse = {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  body: string;
  location?: string;
};

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

function isMarkdownResponse(url: string, contentType: string): boolean {
  return /\b(markdown|mdx?)\b/i.test(contentType) || /\.(md|mdx|markdown)(?:[?#].*)?$/i.test(url);
}

function markdownTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, (_match, alt: string) =>
      alt.trim() ? alt.trim() : "",
    )
    .replace(/<\/?(p|div|span|center|picture|source)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

async function fetchBoundedUrl(url: string, redirects = 0): Promise<BoundedResponse> {
  const addresses = await publicResolvedAddresses(url);
  const response = await requestBoundedUrl(url, addresses[0]);
  if (isRedirectStatus(response.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    if (!response.location) throw new Error("Redirect missing Location header");
    const nextUrl = new URL(response.location, url).toString();
    const safeRedirect = sanitizePublicBrowserUrl(nextUrl);
    if (!safeRedirect) throw new Error("Redirect rejected (must stay public http/https)");
    return fetchBoundedUrl(safeRedirect, redirects + 1);
  }
  return response;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

async function publicResolvedAddresses(raw: string): Promise<ResolvedHostAddress[]> {
  const url = new URL(raw);
  const addresses = await resolveReaderHost(url.hostname);
  if (!addresses.length) throw new Error("Host resolved to no addresses");
  for (const address of addresses) {
    if (!sanitizePublicBrowserUrl(`${url.protocol}//${hostForAddress(address.address)}/`)) {
      throw new Error("Resolved host rejected (must stay public http/https)");
    }
  }
  return addresses;
}

function hostForAddress(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

function normalizeResolvedAddress(input: ResolvedHostInput): ResolvedHostAddress {
  if (typeof input !== "string") return input;
  return { address: input, family: input.includes(":") ? 6 : 4 };
}

function requestBoundedUrl(url: string, address: ResolvedHostAddress): Promise<BoundedResponse> {
  const testRequest = globalThis.__VLLM_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
  if (testRequest) return testRequest(url, address);
  const parsed = new URL(url);
  const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    headers: {
      Accept: ACCEPT,
      "User-Agent": USER_AGENT,
    },
    lookup: ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
      const wantsAll = Boolean((options as { all?: boolean } | undefined)?.all);
      if (wantsAll) callback(null, [address]);
      else callback(null, address.address, address.family);
    }) as RequestOptions["lookup"],
  };

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(parsed, options, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = headerString(response.headers["content-type"]);
      const location = headerString(response.headers.location);
      response.on("data", (raw: Buffer | string) => {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
        if (total >= MAX_BYTES) return;
        const available = MAX_BYTES - total;
        const stored = chunk.length > available ? chunk.subarray(0, available) : chunk;
        chunks.push(stored);
        total += stored.length;
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        const body = new TextDecoder("utf-8", { fatal: false }).decode(concatBytes(chunks, total));
        resolve({
          status,
          ok: status >= 200 && status < 300,
          url,
          contentType,
          body,
          ...(location ? { location } : {}),
        });
      });
      response.on("error", fail);
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error("Fetch timed out")));
    req.on("error", fail);
    req.end();
  });
}

function headerString(value: string | string[] | number | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]?.length === total) return chunks[0];
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
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
  try {
    const response = await fetchBoundedUrl(safe);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned HTTP ${response.status}`, status: response.status },
        { status: 502 },
      );
    }
    const contentType = response.contentType;
    const finalUrl = response.url || safe;
    if (contentType.startsWith("text/html") || contentType.includes("xhtml")) {
      const html = response.body;
      const { title, text } = htmlToReadable(html, finalUrl);
      return NextResponse.json({ url: finalUrl, title, text, markdown: text, contentType });
    }
    if (contentType.startsWith("text/") || contentType.includes("application/json")) {
      const text = response.body.slice(0, MAX_BYTES);
      if (isMarkdownResponse(finalUrl, contentType)) {
        const markdown = cleanMarkdown(text);
        return NextResponse.json({
          url: finalUrl,
          title: markdownTitle(markdown, finalUrl),
          text: markdown,
          markdown,
          contentType,
        });
      }
      return NextResponse.json({ url: finalUrl, title: finalUrl, text, contentType });
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
  }
}
