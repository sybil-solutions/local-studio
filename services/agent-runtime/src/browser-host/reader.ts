// Reading-mode fallback used when headless Chromium is unavailable (and by the
// /api/agent/browser/fetch route directly). Fetches a public http(s) URL with a
// vetted DNS lookup so the embedded server never SSRFs into private nets, caps
// the body, and converts HTML/Markdown into readable text for the model.
//
// This is the fetch+sanitize core that previously lived inline in the fetch
// route; it is shared so the embedded [verb] path can fall back without an HTTP
// self-call.

import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  browserNetworkPolicy,
  type BrowserNetworkPolicy,
  type PinnedBrowserDestination,
} from "./network-policy";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

export type ReaderResult = {
  url: string;
  title: string;
  text: string;
  markdown?: string;
  contentType: string;
};

export type ReaderResponse = {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  body: string;
  location?: string;
};

export type ReaderTransport = (destination: PinnedBrowserDestination) => Promise<ReaderResponse>;
export type ReaderDependencies = {
  policy?: BrowserNetworkPolicy;
  transport?: ReaderTransport;
};

type ReaderRuntime = {
  policy: BrowserNetworkPolicy;
  transport: ReaderTransport;
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
// readability/cheerio; the goal is "good enough for the model to read".
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

async function fetchBoundedUrl(
  url: string,
  mode: BrowserNetworkMode,
  runtime: ReaderRuntime,
  redirects = 0,
): Promise<ReaderResponse> {
  const destination = await runtime.policy.resolve(url, mode);
  const response = await runtime.transport(destination);
  if (isRedirectStatus(response.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    if (!response.location) throw new Error("Redirect missing Location header");
    const nextUrl = new URL(response.location, url).toString();
    return fetchBoundedUrl(nextUrl, mode, runtime, redirects + 1);
  }
  return response;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function requestBoundedUrl(destination: PinnedBrowserDestination): Promise<ReaderResponse> {
  const parsed = destination.url;
  const address = destination.address;
  const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    headers: { Accept: ACCEPT, "User-Agent": USER_AGENT },
    lookup: ((_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    }) satisfies LookupFunction,
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
          url: destination.url.toString(),
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

function renderReadable(response: ReaderResponse, fallbackUrl: string): ReaderResult {
  const contentType = response.contentType;
  const finalUrl = response.url || fallbackUrl;
  if (contentType.startsWith("text/html") || contentType.includes("xhtml")) {
    const { title, text } = htmlToReadable(response.body, finalUrl);
    return { url: finalUrl, title, text, markdown: text, contentType };
  }
  if (contentType.startsWith("text/") || contentType.includes("application/json")) {
    const text = response.body.slice(0, MAX_BYTES);
    if (isMarkdownResponse(finalUrl, contentType)) {
      const markdown = cleanMarkdown(text);
      return {
        url: finalUrl,
        title: markdownTitle(markdown, finalUrl),
        text: markdown,
        markdown,
        contentType,
      };
    }
    return { url: finalUrl, title: finalUrl, text, contentType };
  }
  return {
    url: finalUrl,
    title: finalUrl,
    text: `Non-text response (${contentType || "unknown"}); not rendered.`,
    contentType,
  };
}

// Fetch a public URL and return reading-mode text. Throws on rejected/invalid
// URLs or upstream failures; callers map errors to their own response shape.
export async function fetchReadable(
  rawUrl: string,
  mode: BrowserNetworkMode = "public",
  dependencies: ReaderDependencies = {},
): Promise<ReaderResult> {
  const runtime = {
    policy: dependencies.policy ?? browserNetworkPolicy,
    transport: dependencies.transport ?? requestBoundedUrl,
  };
  if (!runtime.policy.allows(rawUrl, mode))
    throw new Error("url rejected by browser network policy");
  const safe = new URL(rawUrl.trim()).toString();
  const response = await fetchBoundedUrl(safe, mode, runtime);
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  return renderReadable(response, safe);
}
