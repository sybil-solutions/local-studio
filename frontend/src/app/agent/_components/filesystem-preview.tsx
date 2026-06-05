"use client";

import { AssistantMarkdown } from "./assistant-markdown";
import type { PreviewKind } from "@/lib/agent/filesystem-types";

function previewKindForPath(path: string): PreviewKind | null {
  if (/\.(html?|svg)$/i.test(path)) return "html";
  if (/\.(jsx|tsx)$/i.test(path)) return "jsx";
  if (/\.(md|mdx|markdown)$/i.test(path)) return "md";
  return null;
}

// Infer a renderable kind from raw content (no file path available, e.g. the
// canvas buffer). Markdown is the default since most freeform notes are prose.
export function detectPreviewKind(content: string): PreviewKind {
  const trimmed = content.trimStart();
  const hasMarkup = /<[A-Za-z]/.test(content);
  if (
    hasMarkup &&
    (/(^|\n)\s*(import\s.+from|export\s+default|export\s+function)/.test(content) ||
      /\bclassName=/.test(content))
  ) {
    return "jsx";
  }
  if (
    /^<!doctype html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /^<(div|section|main|article|header|footer|nav|aside|h[1-6]|p|ul|ol|table|svg|body|head|span|button|a|img|figure|form|style)\b/i.test(
      trimmed,
    )
  ) {
    return "html";
  }
  return "md";
}

export function previewKindForOpenFile(openFile: string | null): PreviewKind | null {
  return openFile ? previewKindForPath(openFile) : null;
}

function extractJsxPreviewSource(source: string): string {
  const withoutImports = source
    .replace(/^\s*import\s.+?;?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+/gm, "");
  const returnMatch = withoutImports.match(/return\s*\(([\s\S]*?)\)\s*;?\s*}/);
  const arrowMatch = withoutImports.match(/=>\s*\(([\s\S]*?)\)\s*;?\s*$/m);
  const body = (returnMatch?.[1] || arrowMatch?.[1] || withoutImports).trim();
  return body
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\sclassName=/g, " class=")
    .replace(/\shtmlFor=/g, " for=")
    .replace(/\{`([^`]+)`\}/g, "$1")
    .replace(/\{"([^"]*)"\}/g, "$1")
    .replace(/\{'([^']*)'\}/g, "$1")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/<([A-Z][\w.]*)/g, '<div data-component="$1"')
    .replace(/<\/[A-Z][\w.]*>/g, "</div>");
}

function previewDocument(content: string, kind: "html" | "jsx"): string {
  const body = kind === "jsx" ? extractJsxPreviewSource(content) : content;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0}body{font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff}*{box-sizing:border-box}img,video,iframe{max-width:100%}pre,code{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

export function RenderedPreview({ content, kind }: { content: string; kind: PreviewKind }) {
  if (kind === "md") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg) px-3 py-2 text-sm leading-6 text-(--fg)">
        <AssistantMarkdown text={content} />
      </div>
    );
  }
  return (
    <iframe
      title="Rendered file preview"
      sandbox="allow-same-origin allow-popups allow-forms"
      srcDoc={previewDocument(content, kind)}
      className="min-h-0 flex-1 bg-white"
    />
  );
}
