import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
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
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, string[]>();
let registered = false;

export function highlightLines(language: string, lines: readonly string[]): string[] {
  const key = `${language}\u0000${lines.join("\n")}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const highlighted = splitHighlightedLines(highlight(language, lines.join("\n")));
  cache.set(key, highlighted);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return highlighted;
}

function highlight(language: string, code: string): string {
  try {
    registerLanguages();
    if (!hljs.getLanguage(language)) return escapeHtml(code);
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function splitHighlightedLines(html: string): string[] {
  const rendered = [""];
  const openSpans: string[] = [];
  for (const token of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
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

function escapeHtml(code: string): string {
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function registerLanguages(): void {
  if (registered) return;
  const languages = {
    bash,
    c,
    cpp,
    csharp,
    css,
    dart,
    dockerfile,
    go,
    graphql,
    ini,
    java,
    javascript,
    json,
    kotlin,
    lua,
    makefile,
    markdown,
    python,
    r,
    ruby,
    rust,
    scss,
    sql,
    swift,
    typescript,
    xml,
    yaml,
  };
  for (const [name, grammar] of Object.entries(languages)) hljs.registerLanguage(name, grammar);
  registered = true;
}
