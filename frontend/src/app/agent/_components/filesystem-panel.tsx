"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  ChevronLeft,
  ChevronRight,
  Code,
  File,
  Folder,
  Monitor,
  MessageSquare,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import { AssistantMarkdown } from "./assistant-markdown";

type FsEntry = {
  name: string;
  path: string;
  rel: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

type Comment = {
  id: string;
  line: number;
  body: string;
  createdAt: string;
};

type Props = {
  cwd: string | null;
};

const LAST_FILE_KEY_PREFIX = "vllm-studio.agent.lastOpenFile.";

function previewKindForPath(path: string): "html" | "jsx" | "md" | null {
  if (/\.(html?|svg)$/i.test(path)) return "html";
  if (/\.(jsx|tsx)$/i.test(path)) return "jsx";
  if (/\.(md|mdx|markdown)$/i.test(path)) return "md";
  return null;
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
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:16px;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff}*{box-sizing:border-box}img,video,iframe{max-width:100%}pre,code{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

export function FilesystemPanel({ cwd }: Props) {
  const [relPath, setRelPath] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileTruncated, setFileTruncated] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [fileListOpen, setFileListOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");

  // Load directory whenever the cwd or relPath changes.
  useEffect(() => {
    if (!cwd) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relPath)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { entries?: FsEntry[]; error?: string };
        if (!cancelled) setEntries(payload.entries ?? []);
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, relPath]);

  // Restore the last-opened file for this project.
  useEffect(() => {
    if (!cwd) return;
    const remembered = window.localStorage.getItem(LAST_FILE_KEY_PREFIX + cwd);
    if (remembered) setOpenFile(remembered);
  }, [cwd]);

  // Load file contents + comments whenever an open file is selected.
  useEffect(() => {
    if (!cwd || !openFile) {
      setFileContent("");
      setFileTruncated(false);
      setFileSize(0);
      setComments([]);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    (async () => {
      try {
        const [fileResponse, commentsResponse] = await Promise.all([
          fetch(
            `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/agent/comments?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
        ]);
        const fileBody = (await fileResponse.json()) as {
          content?: string;
          truncated?: boolean;
          size?: number;
          error?: string;
        };
        const commentsBody = (await commentsResponse.json()) as { comments?: Comment[] };
        if (cancelled) return;
        setFileContent(fileBody.content ?? "");
        setFileTruncated(fileBody.truncated ?? false);
        setFileSize(fileBody.size ?? 0);
        setComments(commentsBody.comments ?? []);
      } catch {
        if (!cancelled) {
          setFileContent("");
          setComments([]);
        }
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, openFile]);

  const openEntry = useCallback(
    (entry: FsEntry) => {
      if (entry.kind === "directory") {
        setRelPath(entry.rel);
      } else {
        setOpenFile(entry.rel);
        if (cwd) window.localStorage.setItem(LAST_FILE_KEY_PREFIX + cwd, entry.rel);
      }
    },
    [cwd],
  );

  const goUp = useCallback(() => {
    if (!relPath) return;
    const trimmed = relPath.replace(/\/$/, "");
    const idx = trimmed.lastIndexOf("/");
    setRelPath(idx === -1 ? "" : trimmed.slice(0, idx));
  }, [relPath]);

  const lines = useMemo(() => fileContent.split("\n"), [fileContent]);
  const previewKind = useMemo(() => (openFile ? previewKindForPath(openFile) : null), [openFile]);
  const commentsByLine = useMemo(() => {
    const map = new Map<number, Comment[]>();
    for (const c of comments) {
      const list = map.get(c.line) ?? [];
      list.push(c);
      map.set(c.line, list);
    }
    return map;
  }, [comments]);

  const addComment = useCallback(
    async (line: number, body: string) => {
      if (!cwd || !openFile) return;
      const response = await fetch("/api/agent/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, path: openFile, line, body }),
      });
      const payload = (await response.json()) as { comment?: Comment; error?: string };
      if (response.ok && payload.comment) {
        setComments((current) => [...current, payload.comment as Comment]);
      }
    },
    [cwd, openFile],
  );

  const removeComment = useCallback(
    async (id: string) => {
      if (!cwd || !openFile) return;
      await fetch(
        `/api/agent/comments?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setComments((current) => current.filter((c) => c.id !== id));
    },
    [cwd, openFile],
  );

  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center text-center text-[11px] text-(--dim)">
        Pick a project to browse its files.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {fileListOpen ? (
        <div className="flex w-[180px] shrink-0 flex-col border-r border-(--border)">
          <div className="flex h-7 shrink-0 items-center border-b border-(--border)">
            <div className="min-w-0 flex-1">
              <Breadcrumb relPath={relPath} onUp={goUp} onRoot={() => setRelPath("")} />
            </div>
            <button
              type="button"
              onClick={() => setFileListOpen(false)}
              className="mr-1 rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
              title="Collapse file list"
              aria-label="Collapse file list"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => openEntry(entry)}
                title={entry.rel}
                className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-(--surface) ${
                  openFile === entry.rel ? "bg-(--surface) text-(--fg)" : "text-(--dim)"
                }`}
              >
                {entry.kind === "directory" ? (
                  <Folder className="h-3 w-3 shrink-0" />
                ) : (
                  <File className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {entries.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-(--dim)">Empty.</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex w-8 shrink-0 justify-center border-r border-(--border) pt-1">
          <button
            type="button"
            onClick={() => setFileListOpen(true)}
            className="h-6 rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            title="Show file list"
            aria-label="Show file list"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!openFile ? (
          <div className="flex h-full items-center justify-center text-[11px] text-(--dim)">
            Select a file to view.
          </div>
        ) : fileTruncated ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[11px] text-(--dim)">
            <span>Binary or too large to render</span>
            <span className="font-mono">{(fileSize / 1024).toFixed(1)} KB</span>
          </div>
        ) : loadingFile ? (
          <div className="flex h-full items-center justify-center text-[11px] text-(--dim)">
            Loading…
          </div>
        ) : (
          <>
            {previewKind ? (
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-(--border) px-2">
                <div className="min-w-0 truncate font-mono text-[10px] text-(--dim)">
                  {openFile}
                </div>
                <div className="flex items-center gap-1 rounded border border-(--border) bg-(--surface) p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("preview")}
                    className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ${
                      viewMode === "preview"
                        ? "bg-(--bg) text-(--fg)"
                        : "text-(--dim) hover:text-(--fg)"
                    }`}
                  >
                    <Monitor className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("code")}
                    className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ${
                      viewMode === "code"
                        ? "bg-(--bg) text-(--fg)"
                        : "text-(--dim) hover:text-(--fg)"
                    }`}
                  >
                    <Code className="h-3 w-3" />
                    Code
                  </button>
                </div>
              </div>
            ) : null}
            {previewKind && viewMode === "preview" ? (
              <RenderedPreview content={fileContent} kind={previewKind} />
            ) : (
              <FileViewer
                key={openFile}
                lines={lines}
                commentsByLine={commentsByLine}
                onAddComment={addComment}
                onRemoveComment={removeComment}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Breadcrumb({
  relPath,
  onUp,
  onRoot,
}: {
  relPath: string;
  onUp: () => void;
  onRoot: () => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 px-2 text-[11px] text-(--dim)">
      <button
        type="button"
        onClick={onRoot}
        className="rounded px-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
        title="Project root"
      >
        /
      </button>
      {relPath ? (
        <>
          <button
            type="button"
            onClick={onUp}
            className="rounded px-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            title="Up one"
            aria-label="Up one"
          >
            ..
          </button>
          <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)" />
          <span className="truncate font-mono text-[10px]">{relPath}</span>
        </>
      ) : null}
    </div>
  );
}

function RenderedPreview({ content, kind }: { content: string; kind: "html" | "jsx" | "md" }) {
  if (kind === "md") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg) p-4 text-(--fg)">
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

function FileViewer({
  lines,
  commentsByLine,
  onAddComment,
  onRemoveComment,
}: {
  lines: string[];
  commentsByLine: Map<number, Comment[]>;
  onAddComment: (line: number, body: string) => Promise<void>;
  onRemoveComment: (id: string) => Promise<void>;
}) {
  const [composerLine, setComposerLine] = useState<number | null>(null);
  const [composerValue, setComposerValue] = useState("");

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (composerLine === null) return;
      const value = composerValue.trim();
      if (!value) return;
      await onAddComment(composerLine, value);
      setComposerLine(null);
      setComposerValue("");
    },
    [composerLine, composerValue, onAddComment],
  );

  const renderLine = useCallback(
    (index: number) => {
      const lineNumber = index + 1;
      const text = lines[index] ?? "";
      const lineComments = commentsByLine.get(lineNumber) ?? [];
      const composerOpen = composerLine === lineNumber;
      return (
        <div className="group flex flex-col">
          <div
            onClick={() => {
              setComposerLine(lineNumber);
              setComposerValue("");
            }}
            className="flex cursor-text gap-2 px-2 hover:bg-(--surface)"
          >
            <span className="w-10 shrink-0 select-none text-right font-mono text-[10px] leading-5 text-(--dim)">
              {lineNumber}
            </span>
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12px] leading-5 text-(--fg)">
              {text || "\u00a0"}
            </pre>
            {lineComments.length > 0 ? (
              <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded border border-(--border) px-1 font-mono text-[10px] text-(--dim)">
                <MessageSquare className="h-2.5 w-2.5" />
                {lineComments.length}
              </span>
            ) : null}
          </div>

          {lineComments.length > 0 ? (
            <div className="ml-12 mr-2 mb-1 flex flex-col gap-1 border-l-2 border-(--border) pl-2">
              {lineComments.map((c) => (
                <div key={c.id} className="flex items-start gap-1 text-[11px] text-(--fg)">
                  <span className="flex-1 whitespace-pre-wrap">{c.body}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onRemoveComment(c.id);
                    }}
                    className="rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--surface) hover:text-(--err) group-hover:opacity-100"
                    title="Delete comment"
                    aria-label="Delete comment"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {composerOpen ? (
            <form
              onSubmit={submit}
              onClick={(event) => event.stopPropagation()}
              className="ml-12 mr-2 mb-1 rounded border border-(--border) bg-(--surface) p-1.5"
            >
              <textarea
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                autoFocus
                rows={2}
                placeholder={`Comment on line ${lineNumber}…`}
                className="w-full resize-none bg-transparent text-[11px] leading-5 text-(--fg) outline-none"
              />
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setComposerLine(null);
                    setComposerValue("");
                  }}
                  className="h-5 rounded px-1.5 text-[10px] text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-5 rounded bg-(--fg) px-1.5 text-[10px] font-medium text-(--bg) disabled:opacity-30"
                  disabled={!composerValue.trim()}
                >
                  Add
                </button>
              </div>
            </form>
          ) : null}
        </div>
      );
    },
    [lines, commentsByLine, composerLine, composerValue, onRemoveComment, submit],
  );

  // Plain map for short files; virtualized for long ones.
  if (lines.length < 2000) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
