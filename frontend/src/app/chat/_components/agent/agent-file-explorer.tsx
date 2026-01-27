// CRITICAL
"use client";

import { useState, useMemo } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Search,
  Plus,
  FolderPlus,
  Trash2,
  RefreshCw,
} from "lucide-react";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  children?: FileNode[];
  isExpanded?: boolean;
}

interface AgentFileExplorerProps {
  files: FileNode[];
  selectedPath?: string;
  onSelect: (path: string) => void;
  onRefresh?: () => void;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDelete?: (path: string) => void;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function FileTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  onToggle,
}: {
  node: FileNode;
  depth: number;
  selectedPath?: string;
  onSelect: (node: FileNode) => void;
  onToggle: (id: string) => void;
}) {
  const isSelected = selectedPath === node.id;
  const hasChildren = node.type === "directory" && node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors text-[11px] ${
          isSelected
            ? "bg-white/[0.08] text-foreground"
            : "text-[#888] hover:bg-white/[0.04] hover:text-[#aaa]"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {node.type === "directory" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="p-0.5 rounded hover:bg-white/[0.08]"
          >
            {node.isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
        {node.type === "directory" ? (
          <Folder className="h-3.5 w-3.5 text-amber-500/70" />
        ) : (
          <File className="h-3.5 w-3.5 text-blue-400/70" />
        )}
        <span className="flex-1 truncate">{node.name}</span>
        {node.size && node.type === "file" && (
          <span className="text-[10px] text-[#555]">{formatSize(node.size)}</span>
        )}
      </div>
      {node.type === "directory" && node.isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentFileExplorer({
  files,
  selectedPath,
  onSelect,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onDelete,
}: AgentFileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showActions, setShowActions] = useState(false);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filesWithExpanded = useMemo(() => {
    const applyExpanded = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((node) => ({
        ...node,
        isExpanded: expandedIds.has(node.id),
        children: node.children ? applyExpanded(node.children) : undefined,
      }));
    };
    return applyExpanded(files);
  }, [files, expandedIds]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery) return filesWithExpanded;
    const filterNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes
        .map((node) => {
          const matches = node.name.toLowerCase().includes(searchQuery.toLowerCase());
          const filteredChildren = node.children ? filterNodes(node.children) : [];
          if (matches || filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
          }
          return null;
        })
        .filter(Boolean) as FileNode[];
    };
    return filterNodes(filesWithExpanded);
  }, [filesWithExpanded, searchQuery]);

  const handleSelect = (node: FileNode) => {
    if (node.type === "directory") {
      toggleExpanded(node.id);
    }
    onSelect(node.id);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-[#888]">Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded hover:bg-white/[0.06] text-[#666]"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1.5 rounded hover:bg-white/[0.06] text-[#666]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-[#111] border border-white/[0.06] rounded-lg shadow-xl z-10">
                <button
                  onClick={() => {
                    onCreateFile?.(selectedPath || "/");
                    setShowActions(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[#888] hover:bg-white/[0.04]"
                >
                  <File className="h-3 w-3" />
                  New File
                </button>
                <button
                  onClick={() => {
                    onCreateFolder?.(selectedPath || "/");
                    setShowActions(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[#888] hover:bg-white/[0.04]"
                >
                  <FolderPlus className="h-3 w-3" />
                  New Folder
                </button>
                <button
                  onClick={() => {
                    if (selectedPath) onDelete?.(selectedPath);
                    setShowActions(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-400 hover:bg-white/[0.04]"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#555]" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-white/[0.03] border border-white/[0.06] rounded-md text-[#aaa] placeholder:text-[#555] focus:outline-none focus:border-white/[0.12]"
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Folder className="h-8 w-8 text-[#333] mb-2" />
            <p className="text-[11px] text-[#555]">No files</p>
          </div>
        ) : (
          filteredFiles.map((node) => (
            <FileTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              onToggle={toggleExpanded}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/[0.06] text-[10px] text-[#555]">
        {files.length} items
      </div>
    </div>
  );
}
