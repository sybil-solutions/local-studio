import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";

const MAX_CACHE_ENTRIES = 256;

const cache = new Map<string, string>();
let registered = false;

export function highlightFenced(language: string | null, code: string): string {
  const normalizedLanguage = normalizeLanguage(language);
  const cached = peekHighlightFenced(normalizedLanguage, code);
  if (cached !== undefined) return cached;

  const highlighted = highlightUncached(normalizedLanguage, code);
  cache.set(cacheKey(normalizedLanguage, code), highlighted);
  trimCache();
  return highlighted;
}

/**
 * Cache-only lookup (with LRU touch) that never tokenizes. Streaming code
 * blocks use this so a still-growing block renders as plain text instead of
 * re-running hljs over the whole block every frame and flooding the LRU with
 * partial snapshots.
 */
export function peekHighlightFenced(language: string | null, code: string): string | undefined {
  const key = cacheKey(normalizeLanguage(language), code);
  const cached = cache.get(key);
  if (cached === undefined) return undefined;
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

export function highlightLines(language: string | null, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const rendered = [""];
  const openSpans: string[] = [];
  for (const token of highlightFenced(language, lines.join("\n")).split(
    /(<span[^>]*>|<\/span>|\n)/,
  )) {
    const line = rendered.length - 1;
    if (token === "\n") {
      rendered[line] += "</span>".repeat(openSpans.length);
      rendered.push(openSpans.join(""));
    } else if (token.startsWith("<span")) {
      openSpans.push(token);
      rendered[line] += token;
    } else if (token === "</span>") {
      openSpans.pop();
      rendered[line] += token;
    } else {
      rendered[line] += token;
    }
  }
  return rendered;
}

export function escapeHighlightHtml(code: string): string {
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightUncached(language: string | null, code: string): string {
  try {
    ensureLanguagesRegistered();
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    // Untagged blocks render as escaped plaintext. highlightAuto runs the code
    // through every registered grammar — the worst-case path — and opening an
    // old session hits it once per untagged block in the whole transcript.
    return escapeHighlightHtml(code);
  } catch {
    return escapeHighlightHtml(code);
  }
}

function ensureLanguagesRegistered(): void {
  if (registered) return;
  hljs.registerLanguage("typescript", typescript);
  hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
  hljs.registerLanguage("javascript", javascript);
  hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
  hljs.registerLanguage("python", python);
  hljs.registerAliases(["py"], { languageName: "python" });
  hljs.registerLanguage("rust", rust);
  hljs.registerAliases(["rs"], { languageName: "rust" });
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerAliases(["cs"], { languageName: "csharp" });
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("scss", scss);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerAliases(["kt", "kts"], { languageName: "kotlin" });
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerAliases(["rb"], { languageName: "ruby" });
  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("graphql", graphql);
  hljs.registerAliases(["gql"], { languageName: "graphql" });
  hljs.registerLanguage("ini", ini);
  hljs.registerAliases(["toml"], { languageName: "ini" });
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("makefile", makefile);
  hljs.registerLanguage("bash", bash);
  hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerAliases(["yml"], { languageName: "yaml" });
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerAliases(["md"], { languageName: "markdown" });
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("xml", xml);
  registered = true;
}

function normalizeLanguage(language: string | null): string | null {
  const normalized = language?.trim().toLowerCase();
  return normalized || null;
}

function cacheKey(language: string | null, code: string): string {
  return `${language ?? ""}\u0000${code}`;
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
