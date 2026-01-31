// CRITICAL
"use client";

import { useState, useMemo } from "react";
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
  X,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import type { AgentFileEntry } from "@/lib/types";
import type { AgentPlan } from "./agent-types";

interface AgentFilesPanelProps {
  files: AgentFileEntry[];
  plan?: AgentPlan | null;
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  selectedFileLoading: boolean;
  onSelectFile: (path: string | null) => void;
  hasSession: boolean;
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function fileIcon(name: string) {
  const ext = getFileExtension(name);
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "java", "c", "cpp", "h", "css", "scss", "html"].includes(ext))
    return FileCode;
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return FileJson;
  if (["md", "txt", "csv", "log", "env"].includes(ext)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return ImageIcon;
  return File;
}

function getLanguageFromExt(ext: string): string {
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    md: "markdown",
    txt: "plaintext",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
  };
  return langMap[ext] || "plaintext";
}

function isImageFile(name: string): boolean {
  const ext = getFileExtension(name);
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext);
}

function isBase64(str: string): boolean {
  if (!str || str.length < 16) return false;
  if (str.length > 5_000_000) return false;
  if (str.includes("\n") || str.includes("\r")) return false;
  // Avoid false positives for plain text by requiring plausible padding and length.
  if (str.length % 4 !== 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
}

function buildFilePath(entry: AgentFileEntry, parentPath: string): string {
  return parentPath ? `${parentPath}/${entry.name}` : entry.name;
}

function FileTreeNode({
  entry,
  depth,
  parentPath,
  selectedPath,
  onSelect,
}: {
  entry: AgentFileEntry;
  depth: number;
  parentPath: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = entry.type === "dir";
  const Icon = isDir ? (open ? FolderOpen : Folder) : fileIcon(entry.name);
  const fullPath = buildFilePath(entry, parentPath);
  const isSelected = !isDir && selectedPath === fullPath;

  const handleClick = () => {
    if (isDir) {
      setOpen(!open);
    } else {
      onSelect(fullPath);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 py-1 transition-colors text-left ${
          isSelected
            ? "bg-violet-500/15 text-violet-300"
            : isDir
              ? "hover:bg-white/3 cursor-pointer"
              : "hover:bg-white/5 cursor-pointer"
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
          className={`h-3.5 w-3.5 shrink-0 ${
            isSelected ? "text-violet-400" : isDir ? "text-amber-500/70" : "text-blue-400/60"
          }`}
        />
        <span className={`text-[11px] truncate ${isSelected ? "text-violet-300" : "text-[#aaa]"}`}>
          {entry.name}
        </span>
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
            <FileTreeNode
              key={child.name}
              entry={child}
              depth={depth + 1}
              parentPath={fullPath}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileContentViewer({
  path,
  content,
  loading,
  onClose,
  hasSession,
}: {
  path: string;
  content: string | null;
  loading: boolean;
  onClose: () => void;
  hasSession: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const fileName = path.split("/").pop() || path;
  const ext = getFileExtension(fileName);
  const language = getLanguageFromExt(ext);
  const isImage = isImageFile(fileName);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const lineCount = useMemo(() => {
    if (!content) return 0;
    return content.split("\n").length;
  }, [content]);

  return (
    <div className="flex flex-col h-full border-t border-white/6">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/6 bg-[#0c0c0c]">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <span className="text-[11px] text-[#aaa] truncate font-mono">{fileName}</span>
          {!loading && content && (
            <span className="text-[9px] text-[#555] shrink-0">
              {lineCount} lines
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!loading && content && !isImage && (
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-white/5 text-[#555] hover:text-[#888] transition-colors"
              title="Copy content"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/5 text-[#555] hover:text-[#888] transition-colors"
            title="Close file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-[#0a0a0a]">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 text-violet-400 animate-spin" />
          </div>
        ) : content === null ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <File className="h-6 w-6 text-[#333] mb-2" />
            <p className="text-xs text-[#555]">
              {hasSession ? "Failed to load file" : "Start a chat to view files"}
            </p>
          </div>
        ) : isImage ? (
          <div className="flex items-center justify-center p-4 h-full">
            {ext === "svg" ? (
              <div className="flex flex-col items-center justify-center text-center px-4">
                <ImageIcon className="h-8 w-8 text-[#2a2725] mb-3" />
                <p className="text-xs text-[#555]">SVG preview disabled</p>
                <p className="text-[10px] text-[#444]">Open the file contents instead.</p>
              </div>
            ) : (
              // Other images - check if content looks like base64
              isBase64(content) ? (
                <img
                  src={`data:image/${ext};base64,${content}`}
                  alt={fileName}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center px-4">
                  <ImageIcon className="h-8 w-8 text-[#2a2725] mb-3" />
                  <p className="text-xs text-[#555]">Binary image file</p>
                  <p className="text-[10px] text-[#444]">Preview not available</p>
                </div>
              )
            )}
          </div>
        ) : (
          <pre className="p-3 text-[11px] leading-relaxed font-mono text-[#ccc] whitespace-pre-wrap break-words">
            <code className={`language-${language}`}>{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

export function AgentFilesPanel({
  files,
  plan,
  selectedFilePath,
  selectedFileContent,
  selectedFileLoading,
  onSelectFile,
  hasSession,
}: AgentFilesPanelProps) {
  const hasFiles = files.length > 0;
  const hasSelectedFile = selectedFilePath !== null;

  return (
    <div className="flex flex-col h-full">
      {/* Working directory */}
      <div className="px-3 py-2.5 border-b border-white/6 flex items-center gap-2 shrink-0">
        <Terminal className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-[10px] text-[#666] font-mono truncate">~/agent-workspace</span>
      </div>

      {/* File tree - takes remaining space when no file selected, or fixed height when file selected */}
      <div
        className={`overflow-y-auto py-1 ${hasSelectedFile ? "h-[180px] shrink-0 border-b border-white/6" : "flex-1"}`}
      >
        {hasFiles ? (
          files.map((entry) => (
            <FileTreeNode
              key={entry.name}
              entry={entry}
              depth={0}
              parentPath=""
              selectedPath={selectedFilePath}
              onSelect={onSelectFile}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Folder className="h-8 w-8 text-[#2a2725] mb-3" />
            <p className="text-xs text-[#555] mb-1">No files yet</p>
            <p className="text-[10px] text-[#444] max-w-45 leading-relaxed">
              Files created by the agent during execution will appear here.
            </p>
          </div>
        )}
      </div>

      {/* File content viewer - only shown when a file is selected */}
      {hasSelectedFile && (
        <div className="flex-1 min-h-0">
          <FileContentViewer
            path={selectedFilePath}
            content={selectedFileContent}
            loading={selectedFileLoading}
            onClose={() => onSelectFile(null)}
            hasSession={hasSession}
          />
        </div>
      )}

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-white/6 flex items-center justify-between shrink-0">
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
