// CRITICAL
"use client";

import { memo, useState, useMemo } from "react";
import * as Icons from "../../icons";
import { DiffViewer } from "../../code/diff-viewer";
import type { LucideIcon } from "lucide-react";

export interface ToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  outputDetails?: {
    path?: string;
    before?: string;
    after?: string;
    changedFiles?: Array<{ path: string; before: string; after: string }>;
  };
  errorText?: string;
  state?: string;
  [key: string]: unknown;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: Icons.FileText,
  write_file: Icons.FileCode,
  edit_file: Icons.Pencil,
  list_files: Icons.Folder,
  delete_file: Icons.Trash,
  make_directory: Icons.FolderOpen,
  move_file: Icons.Move,
  execute_command: Icons.Terminal,
  computer_use: Icons.Terminal,
  browser_open_url: Icons.Globe,
};

function getToolIcon(toolName: string): LucideIcon {
  const lower = toolName.toLowerCase();
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) return Icons.Search;
  if (lower.includes("browse") || lower.includes("web") || lower.includes("url")) return Icons.Globe;
  return Icons.Wrench;
}

function getToolTarget(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return "";
  const lower = toolName.toLowerCase();
  if (lower.includes("file") || lower.includes("edit")) {
    return typeof inp["path"] === "string" ? shortenPath(inp["path"]) : "";
  }
  if (lower.includes("command") || lower.includes("computer")) {
    const cmd = typeof inp["command"] === "string" ? inp["command"] : typeof inp["cmd"] === "string" ? inp["cmd"] : "";
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  if (lower.includes("browse") || lower.includes("url")) {
    return typeof inp["url"] === "string" ? inp["url"] : "";
  }
  return "";
}

function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return ".../" + parts.slice(-2).join("/");
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type ToolState = "running" | "complete" | "error" | "pending";

function resolveState(part: ToolPart): ToolState {
  const s = part.state ?? "";
  if (s.includes("error") || part.errorText) return "error";
  if (s.includes("output-available") || s === "complete") return "complete";
  if (s.includes("streaming") || s.includes("running") || s === "input-available") return "running";
  if (part.output) return "complete";
  return "pending";
}

interface DiffEntry {
  path?: string;
  oldContent: string;
  newContent: string;
}

/** Prefer structured before/after from the tool result (full file context);
 *  fall back to the raw `old_string`/`new_string` input snippets. */
function getToolDiffs(part: ToolPart): DiffEntry[] {
  const details = part.outputDetails;
  if (details) {
    if (Array.isArray(details.changedFiles) && details.changedFiles.length > 0) {
      return details.changedFiles
        .filter((f) => f.before !== f.after)
        .map((f) => ({ path: f.path, oldContent: f.before, newContent: f.after }));
    }
    if (typeof details.before === "string" && typeof details.after === "string" && details.before !== details.after) {
      return [
        {
          ...(details.path ? { path: details.path } : {}),
          oldContent: details.before,
          newContent: details.after,
        },
      ];
    }
  }

  const inp = part.input as Record<string, unknown> | undefined;
  if (inp) {
    const oldStr = typeof inp["old_string"] === "string" ? inp["old_string"] : null;
    const newStr = typeof inp["new_string"] === "string" ? inp["new_string"] : null;
    if (oldStr && newStr && oldStr !== newStr) {
      const pathValue = typeof inp["path"] === "string" ? inp["path"] : undefined;
      return [
        {
          ...(pathValue ? { path: pathValue } : {}),
          oldContent: oldStr,
          newContent: newStr,
        },
      ];
    }
  }
  return [];
}

/** Try to extract diff from sed command output by parsing before/after patterns */
function getSedDiff(part: ToolPart): { oldContent: string; newContent: string } | null {
  const inp = part.input as Record<string, unknown> | undefined;
  if (!inp) return null;
  const cmd = typeof inp["command"] === "string" ? inp["command"] : typeof inp["cmd"] === "string" ? inp["cmd"] : "";
  // Match sed -i 's/old/new/' or sed -i 's/old/new/g'
  const match = cmd.match(/sed\s+(?:-i\s+)?'s\/(.+?)\/(.+?)\/[gI]*'/);
  if (!match) return null;
  const oldStr = match[1]!.replace(/\\(.)/g, "$1"); // unescape
  const newStr = match[2]!.replace(/\\(.)/g, "$1");
  if (oldStr === newStr) return null;
  return { oldContent: oldStr, newContent: newStr };
}

function InlineToolBlockBase({ part }: { part: ToolPart }) {
  const toolName = part.toolName ?? part.type.replace(/^tool-/, "") ?? "tool";
  const state = resolveState(part);
  const Icon = getToolIcon(toolName);
  const target = useMemo(() => getToolTarget(toolName, part.input), [toolName, part.input]);

  const isSedCommand =
    toolName.toLowerCase().includes("execute_command") || toolName.toLowerCase().includes("computer_use");

  const diffs = useMemo((): DiffEntry[] => {
    const fromTool = getToolDiffs(part);
    if (fromTool.length > 0) return fromTool;
    if (isSedCommand) {
      const fallback = getSedDiff(part);
      if (fallback) return [{ oldContent: fallback.oldContent, newContent: fallback.newContent }];
    }
    return [];
  }, [isSedCommand, part]);

  const hasDiff = diffs.length > 0;

  // Expanded follows `hasDiff` by default so a late-arriving diff (from
  // tool_execution_end or chat_message_upserted) auto-opens the block — but
  // once the user clicks, their choice wins.
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const expanded = userOverride ?? hasDiff;
  const toggleExpanded = () => setUserOverride(!expanded);

  const outputText = useMemo(() => {
    if (part.errorText) return part.errorText;
    if (typeof part.output === "string") return part.output;
    if (part.output && typeof part.output === "object") {
      const o = part.output as Record<string, unknown>;
      if (typeof o["text"] === "string") return o["text"];
      const content = o["content"];
      if (Array.isArray(content)) {
        return content.map((c: { text?: string }) => c.text ?? "").join("");
      }
    }
    return "";
  }, [part.output, part.errorText]);

  const borderClass =
    state === "running" ? "border-violet-500/30" :
    state === "error" ? "border-red-500/30" :
    hasDiff ? "border-green-500/20" :
    "border-(--border)";

  const headerBg =
    state === "running" ? "bg-violet-500/5" :
    state === "error" ? "bg-red-500/5" :
    "bg-(--bg)";

  return (
    <div className={`my-1.5 rounded-md border ${borderClass} overflow-hidden`}>
      <button
        onClick={toggleExpanded}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${headerBg} hover:bg-(--surface) transition-colors`}
      >
        {expanded
          ? <Icons.ChevronDown className="h-3 w-3 text-(--dim) shrink-0" />
          : <Icons.ChevronRight className="h-3 w-3 text-(--dim) shrink-0" />
        }
        <Icon className={`h-3.5 w-3.5 shrink-0 ${
          state === "error" ? "text-red-400" :
          state === "running" ? "text-violet-400" :
          hasDiff ? "text-green-400" :
          "text-(--dim)"
        }`} />
        <span className="text-[11px] font-medium text-(--fg) truncate">
          {formatToolName(toolName)}
        </span>
        {target && (
          <span className="text-[11px] text-(--dim) font-mono truncate flex-1 min-w-0">
            {target}
          </span>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-1">
          {hasDiff && state === "complete" && (
            <span className="text-[10px] text-green-400/70 font-mono">changed</span>
          )}
          {state === "running" && <Icons.Loader2 className="h-3 w-3 text-violet-400 animate-spin" />}
          {state === "complete" && <Icons.CircleCheck className="h-3 w-3 text-green-400" />}
          {state === "error" && <Icons.XCircle className="h-3 w-3 text-red-400" />}
          {state === "pending" && <Icons.Circle className="h-3 w-3 text-(--dim)/30" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-(--border)">
          {hasDiff ? (
            <div className="flex flex-col">
              {diffs.map((d, i) => (
                <div key={`${d.path ?? "diff"}-${i}`} className={i > 0 ? "border-t border-(--border)" : ""}>
                  {d.path && (
                    <div className="px-3 py-1 text-[11px] text-(--dim) font-mono border-b border-(--border)/60 bg-(--bg)/50 truncate">
                      {d.path}
                    </div>
                  )}
                  <DiffViewer oldContent={d.oldContent} newContent={d.newContent} />
                </div>
              ))}
            </div>
          ) : outputText ? (
            <div className="px-3 py-2 max-h-[300px] overflow-auto">
              <pre className="text-[11px] text-(--dim) font-mono whitespace-pre-wrap break-all">
                {outputText.length > 2000 ? outputText.slice(0, 2000) + "\n..." : outputText}
              </pre>
            </div>
          ) : state === "running" ? (
            <div className="px-3 py-2 text-[11px] text-(--dim)">Running...</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const InlineToolBlock = memo(InlineToolBlockBase);
