"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Code,
  File,
  FolderTree,
  Monitor,
  Minus,
  MessageSquarePlus,
  Plus,
  Save,
  SquarePen,
} from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import { useToolSelections, useToolsActions } from "@/features/agent/tools/context";
import type { FileComment, FsEntry } from "@/features/agent/filesystem-types";
import { FileViewer } from "@/features/agent/ui/filesystem-file-viewer";
import { RenderedPreview, previewKindForOpenFile } from "@/features/agent/ui/filesystem-preview";
import { Breadcrumb, fileTone, TreeFileList } from "@/features/agent/ui/filesystem-tree";
import { useFilesystemPanelEffects } from "@/features/agent/ui/filesystem-panel-effects";

type Props = { cwd: string | null };
// eslint-disable-next-line complexity
export function FilesystemPanel({ cwd }: Props) {
  const [relPath, setRelPath] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [draftContent, setDraftContent] = useState<string>("");
  const [fileTruncated, setFileTruncated] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [comments, setComments] = useState<FileComment[]>([]);
  const [viewMode, setViewMode] = useState<"preview" | "code" | "edit">("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Map<string, FsEntry[]>>(new Map());
  const [dirLoading, setDirLoading] = useState<Set<string>>(new Set());
  const [fileListOpen, setFileListOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const { fileOpenRequest } = useToolSelections();
  const { requestContextAttach } = useToolsActions();
  const fontSize = useAppStore((s) => s.fileViewerFontSize);
  const setFontSize = useAppStore((s) => s.setFileViewerFontSize);
  const lastOpenFileByProject = useAppStore((s) => s.lastOpenFileByProject);
  const setLastOpenFileByProject = useAppStore((s) => s.setLastOpenFileByProject);
  const cwdRef = useRef(cwd);
  const pendingEditRef = useRef<{ caret: number; insert: string | null } | null>(null);
  useFilesystemPanelEffects({
    cwd,
    relPath,
    openFile,
    fileOpenRequest,
    lastOpenFileByProject,
    cwdRef,
    setRelPath,
    setEntries,
    setOpenFile,
    setFileContent,
    setDraftContent,
    setFileTruncated,
    setFileSize,
    setLoadingFile,
    setSaveError,
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
  const dirty = draftContent !== fileContent;
  const enterEditMode = useCallback(
    (line: number | null, insert: string | null) => {
      pendingEditRef.current = {
        caret: line === null ? 0 : lines.slice(0, line).join("\n").length,
        insert: line === null ? null : insert,
      };
      setViewMode("edit");
    },
    [lines],
  );
  const focusEditor = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.focus();
    const pending = pendingEditRef.current;
    pendingEditRef.current = null;
    if (!pending) return;
    const caret = Math.min(pending.caret, node.value.length);
    if (pending.insert) {
      node.setRangeText(pending.insert, caret, caret, "end");
      setDraftContent(node.value);
    } else {
      node.setSelectionRange(caret, caret);
    }
  }, []);
  const saveFile = useCallback(async () => {
    if (!cwd || !openFile || fileTruncated) return;
    setSavingFile(true);
    setSaveError(null);
    try {
      const response = await fetch(
        `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: draftContent }),
        },
      );
      const payload = (await response.json()) as {
        content?: string;
        truncated?: boolean;
        size?: number;
        error?: string;
      };
      if (!response.ok || payload.error) throw new Error(payload.error || "Save failed.");
      setFileContent(payload.content ?? draftContent);
      setDraftContent(payload.content ?? draftContent);
      setFileTruncated(payload.truncated ?? false);
      setFileSize(payload.size ?? draftContent.length);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingFile(false);
    }
  }, [cwd, draftContent, fileTruncated, openFile]);
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
      } catch {}
      requestContextAttach({
        label: `${openFile.split("/").pop() ?? openFile} · L${line}`,
        path: openFile,
        content: `Comment on ${openFile} line ${line}: ${body.trim()}`,
      });
    },
    [cwd, openFile, requestContextAttach],
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
      } catch {}
    },
    [cwd, openFile],
  );
  const attachCommentsToChat = useCallback(() => {
    if (!openFile || comments.length === 0) return;
    const ordered = [...comments].sort((a, b) => a.line - b.line);
    const body = ordered.map((comment) => `- Line ${comment.line}: ${comment.body}`).join("\n");
    requestContextAttach({
      label: `${openFile.split("/").pop() ?? openFile} · comments`,
      path: openFile,
      content: `Comments on ${openFile}:\n${body}`,
    });
  }, [comments, openFile, requestContextAttach]);
  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center text-center text-[length:var(--fs-sm)] text-(--dim)">
        Pick a project to browse its files.
      </div>
    );
  }
  return (
    <div className="filesystem-panel relative flex h-full min-h-0 flex-row-reverse bg-(--color-panel)">
      {fileListOpen ? (
        <div className="filesystem-file-list flex w-[236px] shrink-0 flex-col border-l border-(--border)/80 bg-(--sidebar-bg)">
          <div className="flex h-9 shrink-0 items-center border-b border-(--border)/80">
            <div className="min-w-0 flex-1">
              <Breadcrumb relPath={relPath} onRoot={() => setRelPath("")} />
            </div>
            <button
              type="button"
              onClick={() => setFileListOpen(false)}
              className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              title="Collapse file list"
              aria-label="Collapse file list"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex shrink-0 border-b border-(--border)/70 px-2 py-2">
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files…"
              className="h-7 w-full rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim)/75 focus:border-(--border-hover)"
              spellCheck={false}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="ml-1 shrink-0 rounded-md px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
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
            />
            {entries.length === 0 && !searchQuery && (
              <div className="px-2 py-2 text-[length:var(--fs-sm)] text-(--dim)">Empty.</div>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {!openFile ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[length:var(--fs-sm)] text-(--dim)">
            <span>Select a file to view.</span>
            {!fileListOpen ? (
              <button
                type="button"
                onClick={() => setFileListOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
              >
                <FolderTree className="h-3.5 w-3.5" />
                Show files
              </button>
            ) : null}
          </div>
        ) : fileTruncated ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[length:var(--fs-sm)] text-(--dim)">
            <span>Binary or too large to render</span>
            <span className="font-mono">{(fileSize / 1024).toFixed(1)} KB</span>
          </div>
        ) : loadingFile ? (
          <div className="flex h-full items-center justify-center text-[length:var(--fs-sm)] text-(--dim)">
            Loading…
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-(--border)/80 bg-(--color-header) pr-2">
              <div
                className="relative flex h-full min-w-0 max-w-[55%] items-center gap-1.5 border-r border-(--border) bg-(--color-panel) px-3 text-[length:var(--fs-sm)] text-(--fg) after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-(--link)"
                title={openFile}
              >
                <File className={`h-3.5 w-3.5 shrink-0 ${fileTone(openFile)}`} />
                <span className="truncate font-mono">{openFile.split("/").pop() ?? openFile}</span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {comments.length > 0 && (
                  <button
                    type="button"
                    onClick={attachCommentsToChat}
                    className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border)/80 bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                    title="Attach this file's comments to the chat as context"
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                    {comments.length}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewMode("edit")}
                  className={`mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border)/80 bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] ${viewMode === "edit" ? "text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                  title="Edit file"
                >
                  <SquarePen className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void saveFile()}
                  disabled={!dirty || savingFile || fileTruncated}
                  className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border)/80 bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-40"
                  title={dirty ? "Save file" : "No changes to save"}
                >
                  <Save className="h-3 w-3" />
                  {savingFile ? "Saving" : "Save"}
                </button>
                {previewKind && (
                  <div className="mr-1 flex items-center gap-0.5 rounded-md border border-(--border)/80 bg-(--color-input) p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[length:var(--fs-xs)] ${viewMode === "preview" ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    >
                      <Monitor className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("code")}
                      className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[length:var(--fs-xs)] ${viewMode === "code" ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    >
                      <Code className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-0.5 rounded-md border border-(--border)/80 bg-(--color-input) p-0.5">
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.max(8, fontSize - 1))}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-(--dim) hover:text-(--fg)"
                    title="Decrease font size"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-5 text-center text-[length:var(--fs-2xs)] text-(--dim)">
                    {fontSize}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.min(20, fontSize + 1))}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-(--dim) hover:text-(--fg)"
                    title="Increase font size"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {fileListOpen ? (
                  <button
                    type="button"
                    onClick={() => setFileListOpen(false)}
                    className="filesystem-file-list-toggle ml-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border)/80 bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                    title="Hide file list"
                    aria-label="Hide file list"
                  >
                    <FolderTree className="h-3 w-3" />
                  </button>
                ) : null}
                {!fileListOpen ? (
                  <button
                    type="button"
                    onClick={() => setFileListOpen(true)}
                    className="ml-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border)/80 bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                    title="Show file list"
                    aria-label="Show file list"
                  >
                    <FolderTree className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            </div>
            {saveError ? (
              <div className="border-b border-(--err)/30 bg-(--err)/10 px-2 py-1 text-[length:var(--fs-xs)] text-(--err)">
                {saveError}
              </div>
            ) : null}
            {viewMode === "edit" ? (
              <textarea
                ref={focusEditor}
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none overflow-auto bg-(--bg) p-2 font-mono text-(--fg) outline-none"
                style={{ fontSize, lineHeight: `${Math.round(fontSize * 1.5)}px` }}
              />
            ) : previewKind && viewMode === "preview" ? (
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
                onRequestEdit={enterEditMode}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
