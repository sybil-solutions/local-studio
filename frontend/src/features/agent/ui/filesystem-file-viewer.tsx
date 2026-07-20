"use client";

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Virtuoso } from "react-virtuoso";
import { MessageSquarePlus, Minus } from "@/ui/icon-registry";
import { highlightLines } from "@/features/agent/highlight-cache";
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
  html: "xml",
  htm: "xml",
  svg: "xml",
  xml: "xml",
  xsl: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "css",
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
  onRequestEdit,
}: {
  filePath: string;
  lines: string[];
  fontSize: number;
  comments: FileComment[];
  onAddComment: (line: number, body: string) => void;
  onRemoveComment: (id: string) => void;
  onRequestEdit: (line: number | null, insert: string | null) => void;
}) {
  const [composingLine, setComposingLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const lastLineRef = useRef<number | null>(null);
  const highlightedLines = useMemo(() => {
    const lang = languageForPath(filePath);
    if (!lang) return null;
    return highlightLines(lang, lines);
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
  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && !event.target.closest("textarea, button"))
        onRequestEdit(lastLineRef.current, null);
    },
    [onRequestEdit],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element) || event.target.closest("textarea, button")) return;
      const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!printable && event.key !== "Enter") return;
      event.preventDefault();
      onRequestEdit(lastLineRef.current, printable ? event.key : null);
    },
    [onRequestEdit],
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
          <div
            className="flex items-start gap-1 px-1 hover:bg-(--hover)"
            onMouseEnter={() => {
              lastLineRef.current = lineNumber;
            }}
          >
            <span
              className="w-8 shrink-0 select-none text-right font-mono text-(--dim)/70"
              style={{ fontSize: fontSize - 2, lineHeight: `${lineHeight}px` }}
            >
              {lineNumber}
            </span>
            {html ? (
              <pre
                className="syntax-highlight min-w-0 flex-1 whitespace-pre font-mono text-(--fg)"
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
              className="shrink-0 rounded p-0.5 text-(--dim) opacity-0 transition-opacity hover:bg-(--hover) hover:text-(--fg) group-hover:opacity-100"
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
              className="ml-9 mr-2 my-0.5 flex items-start gap-2 rounded-md border border-(--separator) bg-(--color-input) px-2 py-1 text-[length:var(--fs-xs)] text-(--fg)/85"
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
                placeholder="Comment to model… (⌘↵ to send)"
                className="w-full resize-none rounded-md border border-(--border) bg-(--color-input) px-2 py-1 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim)"
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
                  className="rounded-md bg-(--fg) px-2 py-0.5 text-[length:var(--fs-xs)] text-(--bg) hover:opacity-85"
                >
                  Comment to model
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
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-auto py-0.5 outline-none"
        tabIndex={0}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        {lines.map((_, index) => (
          <div key={index}>{renderLine(index)}</div>
        ))}
      </div>
    );
  }
  return (
    <Virtuoso
      className="min-h-0 flex-1 outline-none"
      tabIndex={0}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      totalCount={lines.length}
      itemContent={(index) => renderLine(index)}
    />
  );
}
