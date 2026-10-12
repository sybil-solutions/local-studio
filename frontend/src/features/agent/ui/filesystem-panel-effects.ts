import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { FileOpenRequest } from "@/features/agent/tools/types";
import type { FileComment, FsEntry } from "@/features/agent/filesystem-types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type UseFilesystemPanelEffectsParams = {
  cwd: string | null;
  root: string | null;
  relPath: string;
  openFile: string | null;
  skipTextRead: boolean;
  refreshRevision: number;
  preserveDraft: boolean;
  fileOpenRequest: FileOpenRequest | null;
  lastOpenFileByProject: Record<string, string>;
  rootRef: MutableRefObject<string | null>;
  setRootOverride: Dispatch<SetStateAction<string | null>>;
  setRelPath: Dispatch<SetStateAction<string>>;
  setEntries: Dispatch<SetStateAction<FsEntry[]>>;
  setOpenFile: Dispatch<SetStateAction<string | null>>;
  setFileContent: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setFileTruncated: Dispatch<SetStateAction<boolean>>;
  setFileSize: Dispatch<SetStateAction<number>>;
  setLoadingFile: Dispatch<SetStateAction<boolean>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setComments: Dispatch<SetStateAction<FileComment[]>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setDirChildren: Dispatch<SetStateAction<Map<string, FsEntry[]>>>;
  setDirLoading: Dispatch<SetStateAction<Set<string>>>;
  setLastOpenFileByProject: (projectPath: string, relPath: string) => void;
};

export function useFilesystemPanelEffects({
  cwd,
  root,
  relPath,
  openFile,
  skipTextRead,
  refreshRevision,
  preserveDraft,
  fileOpenRequest,
  lastOpenFileByProject,
  rootRef,
  setRootOverride,
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
}: UseFilesystemPanelEffectsParams): void {
  const handledFileOpenRequest = useRef(0);
  // A file-open request can land on a root the panel is not showing yet (an
  // absolute path outside the session project). Switching roots re-runs the
  // reset effect below, which would wipe the file we were asked to open, so the
  // request parks its target here and the reset effect adopts it.
  const pendingOpen = useRef<{ root: string; rel: string; relPath: string } | null>(null);
  // Root whose open file came from a request, so the "restore last file"
  // effect does not immediately replace it with a remembered one.
  const pendingApplied = useRef<string | null>(null);

  useMountSubscription(() => {
    rootRef.current = root;
  }, [root, rootRef]);

  // Switching session/project drops any external root the panel had adopted.
  useMountSubscription(() => {
    setRootOverride(null);
  }, [cwd, setRootOverride]);

  useMountSubscription(() => {
    const pending = pendingOpen.current;
    const adopted = pending && pending.root === root ? pending : null;
    pendingOpen.current = null;
    pendingApplied.current = adopted ? root : null;
    setRelPath(adopted?.relPath ?? "");
    setOpenFile(adopted?.rel ?? null);
    setFileContent("");
    setDraftContent("");
    setFileTruncated(false);
    setFileSize(0);
    setSaveError(null);
    setComments([]);
    setSearchQuery("");
    setExpandedDirs(new Set());
    setDirChildren(new Map());
    setDirLoading(new Set());
  }, [
    root,
    setComments,
    setDirChildren,
    setDirLoading,
    setDraftContent,
    setExpandedDirs,
    setFileContent,
    setFileSize,
    setFileTruncated,
    setSaveError,
    setOpenFile,
    setRelPath,
    setSearchQuery,
  ]);

  useMountSubscription(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`,
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
  }, [root, relPath, refreshRevision, setEntries]);

  useMountSubscription(() => {
    if (!root || pendingApplied.current === root) return;
    const remembered = lastOpenFileByProject[root];
    if (remembered) setOpenFile(remembered);
  }, [root, lastOpenFileByProject, setOpenFile]);

  useMountSubscription(() => {
    if (!fileOpenRequest || handledFileOpenRequest.current === fileOpenRequest.id) {
      return;
    }
    handledFileOpenRequest.current = fileOpenRequest.id;
    const target = resolveFileOpenTarget(fileOpenRequest.path, cwd);
    if (!target) return;
    // Returning to the session project clears the override rather than pinning
    // an identical root, so the "external root" bar stays off.
    const nextOverride = target.root === cwd ? null : target.root;
    if ((nextOverride ?? cwd) !== root) {
      // Park the target for the reset effect that the root change triggers.
      pendingOpen.current = {
        root: target.root,
        rel: target.kind === "directory" ? "" : target.rel,
        relPath: target.kind === "directory" ? target.rel : "",
      };
      setRootOverride(nextOverride);
      return;
    }
    if (target.kind === "directory") {
      setRelPath(target.rel);
      return;
    }
    setOpenFile(target.rel);
    if (root) setLastOpenFileByProject(root, target.rel);
  }, [
    cwd,
    root,
    fileOpenRequest,
    setLastOpenFileByProject,
    setOpenFile,
    setRelPath,
    setRootOverride,
  ]);

  useMountSubscription(() => {
    if (!root || !openFile || skipTextRead) {
      setFileContent("");
      setDraftContent("");
      setFileTruncated(false);
      setFileSize(0);
      setSaveError(null);
      setComments([]);
      return;
    }
    if (preserveDraft) return;
    let cancelled = false;
    setLoadingFile(true);
    setSaveError(null);
    (async () => {
      try {
        const [fileResponse, commentsResponse] = await Promise.all([
          fetch(
            `/api/agent/fs/file?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/agent/comments?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
        ]);
        const fileBody = (await fileResponse.json()) as {
          content?: string;
          truncated?: boolean;
          size?: number;
          error?: string;
        };
        const commentsBody = (await commentsResponse.json()) as { comments?: FileComment[] };
        if (cancelled) return;
        const nextContent = fileBody.content ?? "";
        setFileContent(nextContent);
        setDraftContent(nextContent);
        setFileTruncated(fileBody.truncated ?? false);
        setFileSize(fileBody.size ?? 0);
        setComments(commentsBody.comments ?? []);
        // A read that fails server-side (missing file, path outside an allowed
        // root) used to leave an empty pane with no explanation.
        if (!fileResponse.ok || fileBody.error) setSaveError(fileBody.error || "Read failed.");
      } catch {
        if (!cancelled) {
          setFileContent("");
          setDraftContent("");
          setComments([]);
          setSaveError("Read failed.");
        }
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    root,
    openFile,
    skipTextRead,
    refreshRevision,
    preserveDraft,
    setComments,
    setDraftContent,
    setFileContent,
    setFileSize,
    setFileTruncated,
    setLoadingFile,
    setSaveError,
  ]);
}

type FileOpenTarget = { root: string; rel: string; kind: "file" | "directory" };

// Resolve a clicked reference into the root the panel should show and the path
// under it. References arrive the way assistants write them: `file://` URLs,
// `path:line:col`, `~/…`, `./…`, repo-relative, or absolute paths that point
// somewhere else entirely (a PDF on the Desktop while the session runs in a
// project). Absolute paths outside the session root resolve against their own
// parent directory rather than returning null — the panel adopts that directory
// as its root so the file actually opens.
export function resolveFileOpenTarget(
  requestPath: string,
  cwd: string | null,
): FileOpenTarget | null {
  const projectRoot = cwd ? cwd.replace(/\/+$/, "") : null;
  const raw = normalizeReference(requestPath, projectRoot);
  if (!raw) return null;
  const isDirectory = raw.endsWith("/");
  const clean = isDirectory ? raw.replace(/\/+$/, "") : raw;
  if (!clean) return null;

  if (projectRoot && (clean === projectRoot || clean.startsWith(`${projectRoot}/`))) {
    return {
      root: projectRoot,
      rel: clean === projectRoot ? "" : clean.slice(projectRoot.length + 1),
      kind: isDirectory ? "directory" : "file",
    };
  }
  if (clean.startsWith("/")) {
    if (isDirectory) return { root: clean, rel: "", kind: "directory" };
    const slash = clean.lastIndexOf("/");
    const parent = clean.slice(0, slash);
    const name = clean.slice(slash + 1);
    if (!name) return null;
    return { root: parent || "/", rel: name, kind: "file" };
  }
  if (!projectRoot) return null;
  const rel = clean.startsWith("./") ? clean.slice(2) : clean;
  if (!rel || rel.startsWith("../")) return null;
  return { root: projectRoot, rel, kind: isDirectory ? "directory" : "file" };
}

// Strip the decorations references arrive with (backticks, a `file://` scheme,
// a `:line:col` suffix) and expand `~`. The renderer has no `os.homedir()`, but
// the session cwd is an absolute path under the same home, so `/Users/<name>` /
// `/home/<name>` recovers it — enough to make `~/…` paths clickable.
function normalizeReference(requestPath: string, projectRoot: string | null): string | null {
  let raw = requestPath.trim();
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  raw = raw.replace(/^`|`$/g, "").replace(/:\d+(?::\d+)?$/, "");
  if (!raw || raw.includes("\0")) return null;
  if (raw !== "~" && !raw.startsWith("~/")) return raw;
  const home = projectRoot?.match(/^(\/(?:Users|home)\/[^/]+)/)?.[1];
  if (!home) return raw;
  return raw === "~" ? `${home}/` : `${home}/${raw.slice(2)}`;
}
