"use client";

import { useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { MessageSquarePlus, Minus } from "lucide-react";
import { highlightFenced } from "@/features/agent/highlight-cache";
import type { FileComment } from "@/features/agent/filesystem-types";

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  html: "html",
  htm: "html",
  svg: "xml",
  xml: "xml",
  xsl: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "shell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  md: "markdown",
  mdx: "markdown",
  dockerfile: "dockerfile",
  makefile: "makefile",
  lua: "lua",
  r: "r",
  dart: "dart",
  zig: "zig",
  vue: "html",
  svelte: "html",
};

function languageForPath(path: string): string | undefined {
  const name = path.split("/").pop() ?? "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile" || lower.startsWith("makefile.")) return "makefile";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT_TO_LANG[ext];
}

export function FileViewer({
  filePath,
  lines,
  fontSize,
  comments,
  onAddComment,
  onRemoveComment,
}: {
  filePath: string;
  lines: string[];
  fontSize: number;
  comments: FileComment[];
  onAddComment: (line: number, body: string) => void;
  onRemoveComment: (id: string) => void;
}) {
  const [composingLine, setComposingLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const highlightedLines = useMemo(() => {
    const lang = languageForPath(filePath);
    if (!lang) return null;
    // Shared curated highlight.js core (a dozen languages); languages outside
    // the set degrade to escaped plain text rather than pulling the full
    // ~190-language package (≈1 MB) into the bundle.
    return highlightFenced(lang, lines.join("\n")).split("\n");
  }, [filePath, lines]);
  const commentsByLine = useMemo(() => {
    const map = new Map<number, FileComment[]>();
    for (const comment of comments) {
      const list = map.get(comment.line) ?? [];
      list.push(comment);
      map.set(comment.line, list);
    }
    return map;
  }, [comments]);
  const lineHeight = Math.round(fontSize * 1.5);
  const submitDraft = useCallback(
    (line: number) => {
      const body = draft.trim();
      if (body) onAddComment(line, body);
      setDraft("");
      setComposingLine(null);
    },
    [draft, onAddComment],
  );
  const renderLine = useCallback(
    (index: number) => {
      const lineNumber = index + 1;
      const text = lines[index] ?? "";
      const html = highlightedLines?.[index];
      const lineComments = commentsByLine.get(lineNumber);
      const composing = composingLine === lineNumber;
      return (
        <div className="group flex flex-col">
          <div className="flex items-start gap-1 px-1 hover:bg-(--surface)">
            <span
              className="w-8 shrink-0 select-none text-right font-mono text-(--dim)"
              style={{ fontSize: fontSize - 2, lineHeight: `${lineHeight}px` }}
            >
              {lineNumber}
            </span>
            {html ? (
              <pre
                className="min-w-0 flex-1 whitespace-pre font-mono text-(--fg)"
                style={{ fontSize, lineHeight: `${lineHeight}px` }}
                dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
              />
            ) : (
              <pre
                className="min-w-0 flex-1 whitespace-pre font-mono text-(--fg)"
                style={{ fontSize, lineHeight: `${lineHeight}px` }}
              >
                {text || "\u00a0"}
              </pre>
            )}
            <button
              type="button"
              onClick={() => {
                setComposingLine(composing ? null : lineNumber);
                setDraft("");
              }}
              className="shrink-0 rounded p-0.5 text-(--dim) opacity-0 transition-opacity hover:text-(--fg) group-hover:opacity-100"
              title="Comment on this line"
              aria-label={`Comment on line ${lineNumber}`}
              style={{ lineHeight: `${lineHeight}px` }}
            >
              <MessageSquarePlus className="h-3 w-3" />
            </button>
          </div>
          {lineComments?.map((comment) => (
            <div
              key={comment.id}
              className="ml-9 mr-2 my-0.5 flex items-start gap-2 rounded border border-(--border)/60 bg-(--surface)/50 px-2 py-1 text-[length:var(--fs-xs)] text-(--fg)/85"
            >
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{comment.body}</span>
              <button
                type="button"
                onClick={() => onRemoveComment(comment.id)}
                className="shrink-0 rounded p-0.5 text-(--dim) hover:text-(--err)"
                title="Delete comment"
                aria-label="Delete comment"
              >
                <Minus className="h-3 w-3" />
              </button>
            </div>
          ))}
          {composing ? (
            <div className="ml-9 mr-2 my-1 flex flex-col gap-1">
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitDraft(lineNumber);
                  }
                  if (event.key === "Escape") {
                    setComposingLine(null);
                    setDraft("");
                  }
                }}
                placeholder="Add a comment… (⌘↵ to save)"
                className="w-full resize-none rounded border border-(--border) bg-(--surface) px-2 py-1 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim)"
                rows={2}
              />
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setComposingLine(null);
                    setDraft("");
                  }}
                  className="rounded px-2 py-0.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => submitDraft(lineNumber)}
                  className="rounded bg-(--accent)/80 px-2 py-0.5 text-[length:var(--fs-xs)] text-white hover:bg-(--accent)"
                >
                  Comment
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    },
    [
      lines,
      highlightedLines,
      fontSize,
      lineHeight,
      commentsByLine,
      composingLine,
      draft,
      submitDraft,
      onRemoveComment,
    ],
  );
  if (lines.length < 2000) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto py-0.5">
        {lines.map((_, index) => (
          <div key={index}>{renderLine(index)}</div>
        ))}
      </div>
    );
  }
  return (
    <Virtuoso
      className="min-h-0 flex-1"
      totalCount={lines.length}
      itemContent={(index) => renderLine(index)}
    />
  );
}
