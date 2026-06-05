"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { Code, Monitor, Minus, MessageSquarePlus, PanelLeftOpen, Plus } from "lucide-react";
import { useAppStore } from "@/store";
import { useFilesystemPanelEffects } from "@/hooks/agent/use-filesystem-panel-effects";
import { useTools } from "@/lib/agent/tools/context";
import type { FileComment, FsEntry } from "@/lib/agent/filesystem-types";
import { FileViewer } from "./filesystem-file-viewer";
import { RenderedPreview, previewKindForOpenFile } from "./filesystem-preview";
import { Breadcrumb, TreeFileList } from "./filesystem-tree";

type Props = { cwd: string | null };
export function FilesystemPanel({ cwd }: Props) {
  const [relPath, setRelPath] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileTruncated, setFileTruncated] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [comments, setComments] = useState<FileComment[]>([]);
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
      if (entry.kind !== "directory") {
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
  const lines = useMemo(() => fileContent.split("\n"), [fileContent]);
  const previewKind = useMemo(() => previewKindForOpenFile(openFile), [openFile]);
  const addComment = useCallback(
    async (line: number, body: string) => {
      if (!cwd || !openFile || !body.trim()) return;
      try {
        const response = await fetch("/api/agent/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, path: openFile, line, body }),
        });
        const payload = (await response.json()) as { comment?: FileComment; error?: string };
        if (payload.comment) setComments((current) => [...current, payload.comment!]);
      } catch {
        // best-effort; comment store errors surface server-side
      }
    },
    [cwd, openFile],
  );
  const removeComment = useCallback(
    async (id: string) => {
      if (!cwd || !openFile) return;
      setComments((current) => current.filter((comment) => comment.id !== id));
      try {
        await fetch(
          `/api/agent/comments?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
      } catch {
        // best-effort
      }
    },
    [cwd, openFile],
  );
  const attachCommentsToChat = useCallback(() => {
    if (!openFile || comments.length === 0) return;
    const ordered = [...comments].sort((a, b) => a.line - b.line);
    const body = ordered.map((comment) => `- Line ${comment.line}: ${comment.body}`).join("\n");
    tools.requestContextAttach({
      label: `${openFile.split("/").pop() ?? openFile} · comments`,
      path: openFile,
      content: `Comments on ${openFile}:\n${body}`,
    });
  }, [comments, openFile, tools]);
  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center text-center text-[length:var(--fs-sm)] text-(--dim)">
        Pick a project to browse its files.
      </div>
    );
  }
  return (
    <div className="relative flex h-full min-h-0">
      {" "}
      {fileListOpen ? (
        <div className="flex w-[200px] shrink-0 flex-col border-r border-(--border)">
          {" "}
          <div className="flex h-7 shrink-0 items-center border-b border-(--border)">
            <div className="min-w-0 flex-1">
              {" "}
              <Breadcrumb relPath={relPath} onRoot={() => setRelPath("")} />
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
              className="w-full rounded border border-(--border) bg-(--surface) px-2 py-0.5 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim)"
              spellCheck={false}
            />{" "}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="ml-1 shrink-0 rounded p-0.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
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
              <div className="px-2 py-2 text-[length:var(--fs-sm)] text-(--dim)">Empty.</div>
            )}
          </div>{" "}
        </div>
      ) : null}
      {!fileListOpen ? (
        <button
          type="button"
          onClick={() => setFileListOpen(true)}
          className="absolute left-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border) bg-(--surface) text-(--fg) shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:bg-(--hover)"
          title="Show file list"
          aria-label="Show file list"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {" "}
        {!openFile ? (
          <div className="flex h-full items-center justify-center text-[length:var(--fs-sm)] text-(--dim)">
            Select a file to view.
          </div>
        ) : fileTruncated ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[length:var(--fs-sm)] text-(--dim)">
            {" "}
            <span>Binary or too large to render</span>
            <span className="font-mono">{(fileSize / 1024).toFixed(1)} KB</span>{" "}
          </div>
        ) : loadingFile ? (
          <div className="flex h-full items-center justify-center text-[length:var(--fs-sm)] text-(--dim)">
            Loading…
          </div>
        ) : (
          <>
            {/* Toolbar: file name + view toggle + font size */}{" "}
            <div
              className={`flex h-8 shrink-0 items-center justify-between gap-1 border-b border-(--border) px-2 ${fileListOpen ? "" : "pl-10"}`}
            >
              <div className="min-w-0 truncate font-mono text-[length:var(--fs-xs)] text-(--dim) flex-1">
                {openFile}
              </div>{" "}
              <div className="flex shrink-0 items-center gap-0.5">
                {comments.length > 0 && (
                  <button
                    type="button"
                    onClick={attachCommentsToChat}
                    className="mr-1 inline-flex h-5 items-center gap-1 rounded border border-(--border) bg-(--surface) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                    title="Attach this file's comments to the chat as context"
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                    {comments.length}
                  </button>
                )}
                {previewKind && (
                  <div className="flex items-center gap-0.5 rounded border border-(--border) bg-(--surface) p-0.5 mr-1">
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[length:var(--fs-xs)] ${viewMode === "preview" ? "bg-(--bg) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    >
                      {" "}
                      <Monitor className="h-3 w-3" />
                    </button>{" "}
                    <button
                      type="button"
                      onClick={() => setViewMode("code")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[length:var(--fs-xs)] ${viewMode === "code" ? "bg-(--bg) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
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
                  <span className="w-5 text-center text-[length:var(--fs-2xs)] text-(--dim)">
                    {fontSize}
                  </span>{" "}
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
                fontSize={fontSize}
                comments={comments}
                onAddComment={addComment}
                onRemoveComment={removeComment}
              />
            )}
          </>
        )}
      </div>{" "}
    </div>
  );
}
