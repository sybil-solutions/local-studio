"use client";

import { useState } from "react";
import {
  diffLineClassName,
  diffLinePrefix,
  pairDiffLines,
  type DiffFile,
  type DiffViewMode,
} from "@/features/agent/ui/git-diff-panel-model";

export function DiffFileList({
  files,
  viewMode,
  onViewMode,
}: {
  files: DiffFile[];
  viewMode: DiffViewMode;
  onViewMode: (mode: DiffViewMode) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[length:var(--fs-sm)] leading-5">
      <div className="sticky top-0 z-10 mb-2 flex items-center justify-end gap-1 bg-(--color-panel) py-1">
        <DiffModeButton active={viewMode === "unified"} onClick={() => onViewMode("unified")}>
          Unified
        </DiffModeButton>
        <DiffModeButton
          active={viewMode === "side-by-side"}
          onClick={() => onViewMode("side-by-side")}
        >
          Side by side
        </DiffModeButton>
        <DiffModeButton active={viewMode === "stacked"} onClick={() => onViewMode("stacked")}>
          Top / bottom
        </DiffModeButton>
      </div>
      <div className="flex flex-col gap-2">
        {files.map((file, fileIndex) => (
          <DiffFileEntry
            key={file.path}
            file={file}
            viewMode={viewMode}
            defaultOpen={fileIndex === 0}
          />
        ))}
      </div>
    </div>
  );
}

// Render a file's diff body only while its <details> is open. A collapsed
// <details> keeps its children in the DOM, so without this a large diff (a
// lockfile, a big refactor) would materialize every file's full line list at
// once — tens of thousands of grid rows — and freeze the pane.
function DiffFileEntry({
  file,
  viewMode,
  defaultOpen,
}: {
  file: DiffFile;
  viewMode: DiffViewMode;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="overflow-hidden rounded-md border border-(--border)/80 bg-(--color-panel)"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 border-b border-(--border)/80 bg-(--color-header) px-2 py-1.5 text-xs text-(--fg) hover:bg-(--color-surface-hover)"
        title={file.path}
      >
        <span className="min-w-0 flex-1 truncate">{file.path}</span>
        <span className="shrink-0 font-mono text-[length:var(--fs-xs)]">
          <span className="text-(--color-diff-added)">+{file.additions}</span>{" "}
          <span className="text-(--color-diff-removed)">-{file.deletions}</span>
        </span>
      </summary>
      {open ? (
        viewMode === "side-by-side" ? (
          <SideBySideDiff file={file} />
        ) : viewMode === "stacked" ? (
          <StackedDiff file={file} />
        ) : (
          <UnifiedDiff file={file} />
        )
      ) : null}
    </details>
  );
}

function DiffModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 rounded px-2 text-[length:var(--fs-xs)] ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}

function UnifiedDiff({ file }: { file: DiffFile }) {
  return (
    <div className="min-w-max">
      {file.lines.map((line, index) => (
        <div
          key={`${file.path}-${index}`}
          className={`grid grid-cols-[3rem_3rem_1fr] gap-2 border-b border-(--border)/20 px-2 ${diffLineClassName(line.kind)}`}
        >
          <span className="select-none text-right text-(--dim)">{line.oldLine ?? ""}</span>
          <span className="select-none text-right text-(--dim)">{line.newLine ?? ""}</span>
          <span className="whitespace-pre">
            {diffLinePrefix(line.kind)}
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function SideBySideDiff({ file }: { file: DiffFile }) {
  const rows = pairDiffLines(file);
  return (
    <div className="min-w-[52rem]">
      {rows.map((row, index) => (
        <div
          key={`${file.path}-pair-${index}`}
          className="grid grid-cols-2 border-b border-(--border)/20"
        >
          <DiffCell line={row.left} side="old" />
          <DiffCell line={row.right} side="new" />
        </div>
      ))}
    </div>
  );
}

function StackedDiff({ file }: { file: DiffFile }) {
  const oldLines = file.lines.filter((line) => line.kind !== "add");
  const newLines = file.lines.filter((line) => line.kind !== "del");
  return (
    <div className="grid gap-2 p-2">
      <div className="rounded border border-red-500/20">
        <div className="border-b border-red-500/20 px-2 py-1 text-[length:var(--fs-sm)] text-red-300">
          Before
        </div>
        {oldLines.map((line, index) => (
          <DiffStackLine key={`${file.path}-old-${index}`} line={line} />
        ))}
      </div>
      <div className="rounded-lg border border-(--color-diff-added)/25">
        <div className="border-b border-(--color-diff-added)/25 px-2 py-1 text-[length:var(--fs-sm)] text-(--color-diff-added)">
          After
        </div>
        {newLines.map((line, index) => (
          <DiffStackLine key={`${file.path}-new-${index}`} line={line} />
        ))}
      </div>
    </div>
  );
}

function DiffCell({ line, side }: { line?: DiffFile["lines"][number]; side: "old" | "new" }) {
  if (!line) {
    return <div className="min-h-5 border-r border-(--border)/20 bg-(--color-surface)" />;
  }
  const lineNumber = side === "old" ? line.oldLine : line.newLine;
  return (
    <div
      className={`grid grid-cols-[3rem_1fr] gap-2 border-r border-(--border)/20 px-2 ${diffLineClassName(line.kind)}`}
    >
      <span className="select-none text-right text-(--dim)">{lineNumber ?? ""}</span>
      <span className="whitespace-pre">
        {diffLinePrefix(line.kind)}
        {line.text}
      </span>
    </div>
  );
}

function DiffStackLine({ line }: { line: DiffFile["lines"][number] }) {
  return (
    <div className={`grid grid-cols-[3rem_1fr] gap-2 px-2 ${diffLineClassName(line.kind)}`}>
      <span className="select-none text-right text-(--dim)">
        {line.kind === "del" ? line.oldLine : (line.newLine ?? line.oldLine ?? "")}
      </span>
      <span className="whitespace-pre">
        {diffLinePrefix(line.kind)}
        {line.text}
      </span>
    </div>
  );
}
