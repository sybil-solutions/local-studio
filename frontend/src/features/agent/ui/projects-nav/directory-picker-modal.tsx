"use client";

import { useCallback, useState } from "react";
import { Button, ErrorBox, UiModal, UiModalHeader } from "@/ui";
import { Folder } from "@/ui/icons";
import { useProjectDirectoryPickerModalEffects } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import type { DirectoryBrowserEntry, DirectoryBrowserPayload } from "./types";

export function ProjectDirectoryPickerModal({
  open,
  error,
  onClose,
  onSelect,
}: {
  open: boolean;
  error: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState("");
  const [entries, setEntries] = useState<DirectoryBrowserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");

  const loadDirectory = useCallback(async (directoryPath?: string) => {
    setLoading(true);
    setBrowseError("");
    try {
      const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : "";
      const response = await fetch(`/api/agent/directories${query}`, { cache: "no-store" });
      const payload = (await response.json()) as DirectoryBrowserPayload;
      if (!response.ok) throw new Error(payload.error || "Failed to list directories");
      setCurrentPath(payload.path);
      setDraftPath(payload.path);
      setParentPath(payload.parent);
      setHomePath(payload.home);
      setEntries(payload.entries ?? []);
    } catch (loadError) {
      setBrowseError(loadError instanceof Error ? loadError.message : "Failed to list directories");
    } finally {
      setLoading(false);
    }
  }, []);

  useProjectDirectoryPickerModalEffects({ loadDirectory, open });

  const goToDraftPath = () => {
    const next = draftPath.trim();
    if (next) void loadDirectory(next);
  };

  return (
    <UiModal isOpen={open} onClose={onClose} maxWidth="max-w-3xl">
      <UiModalHeader
        title="Add project folder"
        icon={<Folder className="h-4 w-4" />}
        onClose={onClose}
      />
      <div className="space-y-4 p-5 text-sm text-(--fg)">
        <p className="text-xs leading-5 text-(--dim)">
          Browse folders on the machine running Local Studio, or paste an absolute path.
        </p>
        <div className="flex gap-2">
          <input
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goToDraftPath();
            }}
            className="min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-3 py-2 font-mono text-xs text-(--fg) outline-none focus:border-(--accent)"
            placeholder="/Users/name/project"
            aria-label="Directory path"
          />
          <Button
            variant="secondary"
            onClick={goToDraftPath}
            disabled={loading || !draftPath.trim()}
          >
            Go
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => homePath && void loadDirectory(homePath)}
            disabled={!homePath || loading}
          >
            Home
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => parentPath && void loadDirectory(parentPath)}
            disabled={!parentPath || loading}
          >
            Up
          </Button>
          <span className="truncate font-mono text-xs text-(--dim)" title={currentPath}>
            {currentPath || "Loading..."}
          </span>
        </div>
        <div className="h-72 overflow-auto rounded-lg border border-(--border) bg-(--bg)">
          {loading ? (
            <div className="px-3 py-8 text-center text-xs text-(--dim)">Loading folders...</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-(--dim)">No subfolders found.</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void loadDirectory(entry.path)}
                className="flex w-full items-center gap-2 border-b border-(--border)/50 px-3 py-2 text-left hover:bg-(--surface)"
                title={entry.path}
              >
                <Folder className="h-4 w-4 shrink-0 text-(--dim)" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>
        {(browseError || error) && <ErrorBox>{browseError || error}</ErrorBox>}
        <div className="flex justify-end gap-2 border-t border-(--border) pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const selectedPath = draftPath.trim() || currentPath;
              if (selectedPath) onSelect(selectedPath);
            }}
            disabled={!(draftPath.trim() || currentPath) || loading}
          >
            Select this folder
          </Button>
        </div>
      </div>
    </UiModal>
  );
}
