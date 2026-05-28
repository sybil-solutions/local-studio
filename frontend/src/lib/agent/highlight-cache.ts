import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

const MAX_CACHE_ENTRIES = 256;

const cache = new Map<string, string>();
let registered = false;

export function highlightFenced(language: string | null, code: string): string {
  const normalizedLanguage = normalizeLanguage(language);
  const key = cacheKey(normalizedLanguage, code);
  const cached = cache.get(key);
  if (cached !== undefined) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const highlighted = highlightUncached(normalizedLanguage, code);
  cache.set(key, highlighted);
  trimCache();
  return highlighted;
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
    return hljs.highlightAuto(code).value;
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
  hljs.registerLanguage("bash", bash);
  hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerAliases(["yml"], { languageName: "yaml" });
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerAliases(["md"], { languageName: "markdown" });
  hljs.registerLanguage("diff", diff);
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
