"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, File, Folder } from "@/ui/icon-registry";
import type { FsEntry } from "@/features/agent/filesystem-types";

const TONE_GROUPS: [string, string[]][] = [
  [
    "text-(--link)",
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "py",
      "rs",
      "go",
      "rb",
      "java",
      "c",
      "cpp",
      "h",
      "swift",
      "kt",
    ],
  ],
  ["text-(--warn)", ["css", "scss", "sass", "less", "sh", "bash", "zsh", "fish"]],
  ["text-(--ok)", ["json", "yaml", "yml", "toml", "ini", "env", "lock"]],
  ["text-(--fg) opacity-60", ["md", "mdx", "txt", "rst"]],
  ["text-(--err) opacity-70", ["png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "mov"]],
];

const FILE_TONE_BY_EXT: Record<string, string> = Object.fromEntries(
  TONE_GROUPS.flatMap(([tone, exts]) => exts.map((ext) => [ext, tone] as const)),
);

export function fileTone(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return FILE_TONE_BY_EXT[ext] ?? "text-(--dim)";
}

function formatEntrySize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)}K`;
  return `${(size / (1024 * 1024)).toFixed(1)}M`;
}

export function Breadcrumb({ relPath, onRoot }: { relPath: string; onRoot: () => void }) {
  const parts = relPath ? relPath.split("/").filter(Boolean) : [];
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto px-2 text-[length:var(--fs-sm)] text-(--dim)">
      <button
        type="button"
        onClick={onRoot}
        className="shrink-0 rounded-md px-1.5 text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        title="Project root"
      >
        /
      </button>
      {parts.length > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)" />}
      {parts.map((part, i) => (
        <span key={i} className="flex shrink-0 items-center gap-0.5">
          <span className="truncate font-mono text-[length:var(--fs-xs)] text-(--fg)">{part}</span>
          {i < parts.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)" />}
        </span>
      ))}
    </div>
  );
}

export function TreeFileList({
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
    return entries.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  return (
    <>
      {filtered.map((entry) => {
        const isDir = entry.kind === "directory";
        const isExpanded = expandedDirs.has(entry.rel);
        const isLoading = dirLoading.has(entry.rel);
        const indent = depth * 12;
        const isActive = openFile === entry.rel;
        const children = isDir && isExpanded ? dirChildren.get(entry.rel) : undefined;
        return (
          <div key={entry.path}>
            <div
              className={`relative flex w-full items-center gap-1 rounded-sm py-0.5 text-left text-[length:var(--fs-sm)] hover:bg-(--hover) ${isActive ? "bg-(--color-selected) font-medium text-(--fg)" : "text-(--dim)"}`}
              style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
            >
              {isActive ? (
                <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-(--link)" />
              ) : null}
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
                  {isLoading ? (
                    <span className="text-[length:var(--fs-2xs)] text-(--dim)">…</span>
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
                onClick={() => (isDir ? onToggleDir(entry.rel) : onOpen(entry))}
                title={entry.rel}
                aria-current={isActive ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                {isDir ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
                ) : (
                  <File className={`h-3.5 w-3.5 shrink-0 ${fileTone(entry.name)}`} />
                )}
                <span className="flex-1 truncate">{entry.name}</span>
                {!isDir && entry.size != null && entry.size > 0 ? (
                  <span className="shrink-0 text-[length:var(--fs-2xs)] text-(--dim)">
                    {formatEntrySize(entry.size)}
                  </span>
                ) : null}
              </button>
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
            ) : null}
          </div>
        );
      })}
    </>
  );
}
