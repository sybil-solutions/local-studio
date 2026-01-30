// CRITICAL
"use client";

import { useState } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Image as ImageIcon,
  Terminal,
} from "lucide-react";
import type { AgentFileEntry } from "@/lib/types";
import type { AgentPlan } from "./agent-types";

interface AgentFilesPanelProps {
  files: AgentFileEntry[];
  plan?: AgentPlan | null;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "java", "c", "cpp", "h"].includes(ext))
    return FileCode;
  if (["json", "yaml", "yml", "toml"].includes(ext)) return FileJson;
  if (["md", "txt", "csv", "log"].includes(ext)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return ImageIcon;
  return File;
}

function FileTreeNode({ entry, depth }: { entry: AgentFileEntry; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = entry.type === "dir";
  const Icon = isDir ? (open ? FolderOpen : Folder) : fileIcon(entry.name);

  return (
    <div>
      <button
        onClick={() => isDir && setOpen(!open)}
        className={`w-full flex items-center gap-1.5 py-1 hover:bg-white/[0.03] transition-colors text-left ${
          isDir ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isDir && (
          <span className="w-3 shrink-0 text-[#555]">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        {!isDir && <span className="w-3 shrink-0" />}
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${isDir ? "text-amber-500/70" : "text-blue-400/60"}`}
        />
        <span className="text-[11px] text-[#aaa] truncate">{entry.name}</span>
        {entry.size != null && !isDir && (
          <span className="text-[9px] text-[#444] ml-auto pr-2 shrink-0">
            {entry.size < 1024
              ? `${entry.size}B`
              : entry.size < 1048576
                ? `${(entry.size / 1024).toFixed(1)}K`
                : `${(entry.size / 1048576).toFixed(1)}M`}
          </span>
        )}
      </button>
      {isDir && open && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode key={child.name} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentFilesPanel({ files, plan }: AgentFilesPanelProps) {
  const hasFiles = files.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Working directory */}
      <div className="px-3 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
        <Terminal className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-[10px] text-[#666] font-mono truncate">~/agent-workspace</span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {hasFiles ? (
          files.map((entry) => <FileTreeNode key={entry.name} entry={entry} depth={0} />)
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Folder className="h-8 w-8 text-[#2a2725] mb-3" />
            <p className="text-xs text-[#555] mb-1">No files yet</p>
            <p className="text-[10px] text-[#444] max-w-[180px] leading-relaxed">
              Files created by the agent during execution will appear here.
            </p>
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-[10px] text-[#555]">
          {hasFiles ? `${countFiles(files)} files` : "Empty"}
        </span>
        {plan && (
          <span className="text-[10px] text-[#555]">
            {plan.steps.filter((s) => s.status === "done").length}/{plan.steps.length} steps
          </span>
        )}
      </div>
    </div>
  );
}

function countFiles(entries: AgentFileEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.type === "file") count++;
    if (e.children) count += countFiles(e.children);
  }
  return count;
}
