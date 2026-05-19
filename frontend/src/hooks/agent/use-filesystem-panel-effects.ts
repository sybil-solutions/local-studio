import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FileOpenRequest } from "@/lib/agent/tools/types";

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

type UseFilesystemPanelEffectsParams = {
  cwd: string | null;
  relPath: string;
  openFile: string | null;
  fileOpenRequest: FileOpenRequest | null;
  lastOpenFileByProject: Record<string, string>;
  cwdRef: MutableRefObject<string | null>;
  setRelPath: Dispatch<SetStateAction<string>>;
  setEntries: Dispatch<SetStateAction<FsEntry[]>>;
  setOpenFile: Dispatch<SetStateAction<string | null>>;
  setFileContent: Dispatch<SetStateAction<string>>;
  setFileTruncated: Dispatch<SetStateAction<boolean>>;
  setFileSize: Dispatch<SetStateAction<number>>;
  setLoadingFile: Dispatch<SetStateAction<boolean>>;
  setComments: Dispatch<SetStateAction<Comment[]>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setDirChildren: Dispatch<SetStateAction<Map<string, FsEntry[]>>>;
  setDirLoading: Dispatch<SetStateAction<Set<string>>>;
  setLastOpenFileByProject: (projectPath: string, relPath: string) => void;
};

export function useFilesystemPanelEffects({
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
  setFileTruncated,
  setFileSize,
  setLoadingFile,
  setComments,
  setSearchQuery,
  setExpandedDirs,
  setDirChildren,
  setDirLoading,
  setLastOpenFileByProject,
}: UseFilesystemPanelEffectsParams): void {
  const handledFileOpenRequest = useRef(0);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd, cwdRef]);

  useEffect(() => {
    setRelPath("");
    setOpenFile(null);
    setSearchQuery("");
    setExpandedDirs(new Set());
    setDirChildren(new Map());
    setDirLoading(new Set());
  }, [
    cwd,
    setDirChildren,
    setDirLoading,
    setExpandedDirs,
    setOpenFile,
    setRelPath,
    setSearchQuery,
  ]);

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
  }, [cwd, relPath, setEntries]);

  useEffect(() => {
    if (!cwd) return;
    const remembered = lastOpenFileByProject[cwd];
    if (remembered) setOpenFile(remembered);
  }, [cwd, lastOpenFileByProject, setOpenFile]);

  useEffect(() => {
    if (!fileOpenRequest || handledFileOpenRequest.current === fileOpenRequest.id) return;
    handledFileOpenRequest.current = fileOpenRequest.id;
    const rel = relativePathForRequest(fileOpenRequest.path, cwd);
    if (!rel) return;
    setOpenFile(rel);
    if (cwd) setLastOpenFileByProject(cwd, rel);
  }, [cwd, fileOpenRequest, setLastOpenFileByProject, setOpenFile]);

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
  }, [cwd, openFile, setComments, setFileContent, setFileSize, setFileTruncated, setLoadingFile]);
}

function relativePathForRequest(path: string, cwd: string | null): string | null {
  let raw = path.trim();
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
  if (cwd && raw.startsWith(`${cwd.replace(/\/+$/, "")}/`)) {
    return raw.slice(cwd.replace(/\/+$/, "").length + 1);
  }
  if (raw.startsWith("./")) return raw.slice(2);
  if (!raw.startsWith("/") && !raw.startsWith("../")) return raw;
  return null;
}
