"use client";
import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  ChevronRight,
  ChevronDown,
  Code,
  File,
  Folder,
  Monitor,
  MessageSquare,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import hljs from "highlight.js";
import { useAppStore } from "@/store";
import { useFilesystemPanelEffects } from "@/hooks/agent/use-filesystem-panel-effects";
import { useTools } from "@/lib/agent/tools/context";
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
type Props = { cwd: string | null };
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

function TreeFileList({
  entries,
  searchQuery,
  openFile,
  onOpen,
  onToggleDir,
  depth,
  expandedDirs,
  dirChildren,
  dirLoading,
}: {
  entries: FsEntry[];
  searchQuery: string;
  openFile: string | null;
  onOpen: (entry: FsEntry) => void;
  onToggleDir: (rel: string) => void;
  depth: number;
  expandedDirs: Set<string>;
  dirChildren: Map<string, FsEntry[]>;
  dirLoading: Set<string>;
}) {
  const filtered = useMemo(() => {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);
  return (
    <>
      {" "}
      {filtered.map((entry) => {
        const isDir = entry.kind === "directory";
        const isExpanded = expandedDirs.has(entry.rel);
        const isLoading = dirLoading.has(entry.rel);
        const indent = depth * 12;
        const isActive = openFile === entry.rel;
        const children = isDir && isExpanded ? dirChildren.get(entry.rel) : undefined;
        return (
          <div key={entry.path}>
            {" "}
            <div
              className={`flex w-full items-center gap-1 py-0.5 text-left text-[11px] hover:bg-(--surface) ${isActive ? "bg-(--surface) text-(--fg)" : "text-(--dim)"}`}
              style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
            >
              {isDir ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleDir(entry.rel);
                  }}
                  className="flex h-3 w-3 shrink-0 items-center justify-center"
                  aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                  title={isExpanded ? "Collapse" : "Expand"}
                >
                  {" "}
                  {isLoading ? (
                    <span className="text-[8px] text-(--dim)">…</span>
                  ) : isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onOpen(entry)}
                title={entry.rel}
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                {" "}
                {isDir ? (
                  <Folder className="h-3 w-3 shrink-0 text-(--accent)" />
                ) : (
                  <File className="h-3 w-3 shrink-0" />
                )}
                <span className="flex-1 truncate">{entry.name}</span>{" "}
                {!isDir && entry.size != null && entry.size > 0 ? (
                  <span className="shrink-0 text-[9px] text-(--dim)">
                    {entry.size < 1024
                      ? `${entry.size}B`
                      : entry.size < 1024 * 1024
                        ? `${(entry.size / 1024).toFixed(0)}K`
                        : `${(entry.size / (1024 * 1024)).toFixed(1)}M`}
                  </span>
                ) : null}
              </button>{" "}
            </div>
            {children ? (
              <TreeFileList
                entries={children}
                searchQuery={searchQuery}
                openFile={openFile}
                onOpen={onOpen}
                onToggleDir={onToggleDir}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                dirChildren={dirChildren}
                dirLoading={dirLoading}
              />
            ) : null}{" "}
          </div>
        );
      })}
    </>
  );
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
  const [viewMode, setViewMode] = useState<"preview" | "code">("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Map<string, FsEntry[]>>(new Map());
  const [dirLoading, setDirLoading] = useState<Set<string>>(new Set());
  const [fileListOpen, setFileListOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const tools = useTools();
  const fontSize = useAppStore((s) => s.fileViewerFontSize);
  const setFontSize = useAppStore((s) => s.setFileViewerFontSize);
  const lastOpenFileByProject = useAppStore((s) => s.lastOpenFileByProject);
  const setLastOpenFileByProject = useAppStore((s) => s.setLastOpenFileByProject);
  const cwdRef = useRef(cwd);
  useFilesystemPanelEffects({
    cwd,
    relPath,
    openFile,
    fileOpenRequest: tools.fileOpenRequest,
    lastOpenFileByProject,
    cwdRef,
    setRelPath,
    setEntries,
    setOpenFile,
    setFileContent,
    setFileTruncated,
    setFileSize,
    setLoadingFile,
    setComments,
    setSearchQuery,
    setExpandedDirs,
    setDirChildren,
    setDirLoading,
    setLastOpenFileByProject,
  });
  const fetchDirChildren = useCallback(
    async (dirRel: string) => {
      const requestCwd = cwd;
      if (!requestCwd) return;
      setDirLoading((prev) => new Set(prev).add(dirRel));
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(requestCwd)}&path=${encodeURIComponent(dirRel)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { entries?: FsEntry[]; error?: string };
        if (cwdRef.current !== requestCwd) return;
        setDirChildren((prev) => new Map(prev).set(dirRel, payload.entries ?? []));
      } catch {
        if (cwdRef.current !== requestCwd) return;
        setDirChildren((prev) => new Map(prev).set(dirRel, []));
      } finally {
        if (cwdRef.current !== requestCwd) return;
        setDirLoading((prev) => {
          const next = new Set(prev);
          next.delete(dirRel);
          return next;
        });
      }
    },
    [cwd],
  );
  const openEntry = useCallback(
    (entry: FsEntry) => {
      if (entry.kind === "directory") {
        setRelPath(entry.rel);
      } else {
        setOpenFile(entry.rel);
        if (cwd) setLastOpenFileByProject(cwd, entry.rel);
      }
    },
    [cwd, setLastOpenFileByProject],
  );
  const toggleDir = useCallback(
    (rel: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(rel)) {
          next.delete(rel);
        } else {
          next.add(rel);
          if (!dirChildren.has(rel)) {
            void fetchDirChildren(rel);
          }
        }
        return next;
      });
    },
    [dirChildren, fetchDirChildren],
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
      {" "}
      {fileListOpen ? (
        <div className="flex w-[200px] shrink-0 flex-col border-r border-(--border)">
          {" "}
          <div className="flex h-7 shrink-0 items-center border-b border-(--border)">
            <div className="min-w-0 flex-1">
              {" "}
              <Breadcrumb relPath={relPath} onUp={goUp} onRoot={() => setRelPath("")} />
            </div>{" "}
            <button
              type="button"
              onClick={() => setFileListOpen(false)}
              className="mr-1 rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
              title="Collapse file list"
              aria-label="Collapse file list"
            >
              <Minus className="h-3.5 w-3.5" />{" "}
            </button>
          </div>{" "}
          <div className="flex shrink-0 border-b border-(--border) px-1.5 py-1">
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files…"
              className="w-full rounded border border-(--border) bg-(--surface) px-2 py-0.5 text-[10px] text-(--fg) outline-none placeholder:text-(--dim)"
              spellCheck={false}
            />{" "}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="ml-1 shrink-0 rounded p-0.5 text-[10px] text-(--dim) hover:text-(--fg)"
                title="Clear search"
              >
                {" "}
                ✕
              </button>
            )}
          </div>{" "}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <TreeFileList
              entries={entries}
              searchQuery={searchQuery}
              openFile={openFile}
              onOpen={openEntry}
              onToggleDir={toggleDir}
              depth={0}
              expandedDirs={expandedDirs}
              dirChildren={dirChildren}
              dirLoading={dirLoading}
            />{" "}
            {entries.length === 0 && !searchQuery && (
              <div className="px-2 py-2 text-[11px] text-(--dim)">Empty.</div>
            )}
          </div>{" "}
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
            {" "}
            <Plus className="h-3.5 w-3.5" />
          </button>{" "}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {" "}
        {!openFile ? (
          <div className="flex h-full items-center justify-center text-[11px] text-(--dim)">
            Select a file to view.
          </div>
        ) : fileTruncated ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[11px] text-(--dim)">
            {" "}
            <span>Binary or too large to render</span>
            <span className="font-mono">{(fileSize / 1024).toFixed(1)} KB</span>{" "}
          </div>
        ) : loadingFile ? (
          <div className="flex h-full items-center justify-center text-[11px] text-(--dim)">
            Loading…
          </div>
        ) : (
          <>
            {/* Toolbar: file name + view toggle + font size */}{" "}
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-(--border) px-2 gap-1">
              <div className="min-w-0 truncate font-mono text-[10px] text-(--dim) flex-1">
                {openFile}
              </div>{" "}
              <div className="flex shrink-0 items-center gap-0.5">
                {previewKind && (
                  <div className="flex items-center gap-0.5 rounded border border-(--border) bg-(--surface) p-0.5 mr-1">
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ${viewMode === "preview" ? "bg-(--bg) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    >
                      {" "}
                      <Monitor className="h-3 w-3" />
                    </button>{" "}
                    <button
                      type="button"
                      onClick={() => setViewMode("code")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ${viewMode === "code" ? "bg-(--bg) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    >
                      <Code className="h-3 w-3" />{" "}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-0.5 rounded border border-(--border) bg-(--surface) p-0.5">
                  {" "}
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.max(8, fontSize - 1))}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-(--dim) hover:text-(--fg)"
                    title="Decrease font size"
                  >
                    <Minus className="h-3 w-3" />{" "}
                  </button>
                  <span className="w-5 text-center text-[9px] text-(--dim)">{fontSize}</span>{" "}
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.min(20, fontSize + 1))}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-(--dim) hover:text-(--fg)"
                    title="Increase font size"
                  >
                    <Plus className="h-3 w-3" />{" "}
                  </button>
                </div>{" "}
              </div>
            </div>{" "}
            {previewKind && viewMode === "preview" ? (
              <RenderedPreview content={fileContent} kind={previewKind} />
            ) : (
              <FileViewer
                key={openFile}
                filePath={openFile}
                lines={lines}
                commentsByLine={commentsByLine}
                onAddComment={addComment}
                onRemoveComment={removeComment}
                fontSize={fontSize}
              />
            )}
          </>
        )}
      </div>{" "}
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
  const parts = relPath ? relPath.split("/").filter(Boolean) : [];
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto px-2 text-[11px] text-(--dim)">
      <button
        type="button"
        onClick={onRoot}
        className="shrink-0 rounded px-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
        title="Project root"
      >
        {" "}
        /
      </button>{" "}
      {parts.length > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)" />}
      {parts.map((part, i) => (
        <span key={i} className="flex shrink-0 items-center gap-0.5">
          <span className="truncate font-mono text-[10px] text-(--fg)">{part}</span>{" "}
          {i < parts.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)" />}
        </span>
      ))}
      <button
        type="button"
        onClick={onUp}
        className="ml-auto shrink-0 rounded px-1 text-[10px] text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
        title="Go up"
        aria-label="Go up"
      >
        {" "}
        ⬆
      </button>{" "}
    </div>
  );
}

function RenderedPreview({ content, kind }: { content: string; kind: "html" | "jsx" | "md" }) {
  if (kind === "md") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg) p-4 text-(--fg) text-sm leading-6">
        <AssistantMarkdown text={content} />{" "}
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
  filePath,
  lines,
  commentsByLine,
  onAddComment,
  onRemoveComment,
  fontSize,
}: {
  filePath: string;
  lines: string[];
  commentsByLine: Map<number, Comment[]>;
  onAddComment: (line: number, body: string) => Promise<void>;
  onRemoveComment: (id: string) => Promise<void>;
  fontSize: number;
}) {
  const [composerLine, setComposerLine] = useState<number | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const highlightedLines = useMemo(() => {
    const lang = languageForPath(filePath);
    if (!lang) return null;
    try {
      const result = hljs.highlight(lines.join("\n"), { language: lang });
      return result.value.split("\n");
    } catch {
      return null;
    }
  }, [filePath, lines]);
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
  const lineHeight = Math.round(fontSize * 1.5);
  const renderLine = useCallback(
    (index: number) => {
      const lineNumber = index + 1;
      const text = lines[index] ?? "";
      const lineComments = commentsByLine.get(lineNumber) ?? [];
      const composerOpen = composerLine === lineNumber;
      const html = highlightedLines?.[index];
      return (
        <div className="group flex flex-col">
          <div
            onClick={() => {
              setComposerLine(lineNumber);
              setComposerValue("");
            }}
            className="flex cursor-text gap-1 px-1 hover:bg-(--surface)"
          >
            {" "}
            <span
              className="w-8 shrink-0 select-none text-right font-mono text-(--dim)"
              style={{ fontSize: fontSize - 2, lineHeight: `${lineHeight}px` }}
            >
              {lineNumber}{" "}
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
            )}{" "}
            {lineComments.length > 0 ? (
              <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded border border-(--border) px-1 font-mono text-[9px] text-(--dim)">
                {" "}
                <MessageSquare className="h-2 w-2" />
                {lineComments.length}{" "}
              </span>
            ) : null}{" "}
          </div>
          {lineComments.length > 0 ? (
            <div className="ml-10 mr-2 mb-0.5 flex flex-col gap-1 border-l-2 border-(--border) pl-2">
              {" "}
              {lineComments.map((c) => (
                <div key={c.id} className="flex items-start gap-1 text-[11px] text-(--fg)">
                  {" "}
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
                    <Trash2 className="h-2.5 w-2.5" />{" "}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {composerOpen ? (
            <form
              onSubmit={submit}
              onClick={(event) => event.stopPropagation()}
              className="ml-10 mr-2 mb-0.5 rounded border border-(--border) bg-(--surface) p-1.5"
            >
              {" "}
              <textarea
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                autoFocus
                rows={2}
                placeholder={`Comment on line ${lineNumber}…`}
                className="w-full resize-none bg-transparent text-[11px] leading-5 text-(--fg) outline-none"
              />
              <div className="flex items-center justify-end gap-1">
                {" "}
                <button
                  type="button"
                  onClick={() => {
                    setComposerLine(null);
                    setComposerValue("");
                  }}
                  className="h-5 rounded px-1.5 text-[10px] text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
                >
                  {" "}
                  Cancel
                </button>{" "}
                <button
                  type="submit"
                  className="h-5 rounded bg-(--fg) px-1.5 text-[10px] font-medium text-(--bg) disabled:opacity-30"
                  disabled={!composerValue.trim()}
                >
                  Add{" "}
                </button>
              </div>{" "}
            </form>
          ) : null}{" "}
        </div>
      );
    },
    [
      lines,
      highlightedLines,
      commentsByLine,
      composerLine,
      composerValue,
      onRemoveComment,
      submit,
      fontSize,
      lineHeight,
    ],
  );
  if (lines.length < 2000) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto py-0.5">
        {lines.map((_, index) => (
          <div key={index}>{renderLine(index)}</div>
        ))}{" "}
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
