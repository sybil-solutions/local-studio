// CRITICAL
"use client";

import { useMemo, useState } from "react";

const CONTEXT_LINES = 3;

interface DiffLine {
  type: "equal" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  let oldLineNo = m;
  let newLineNo = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "equal", content: oldLines[i - 1]!, oldLineNo: oldLineNo--, newLineNo: newLineNo-- });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.unshift({ type: "add", content: newLines[j - 1]!, newLineNo: newLineNo-- });
      j--;
    } else {
      result.unshift({ type: "remove", content: oldLines[i - 1]!, oldLineNo: oldLineNo-- });
      i--;
    }
  }

  return result;
}

type ViewItem =
  | { kind: "line"; line: DiffLine; idx: number }
  | { kind: "collapsed"; start: number; end: number; count: number };

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  language?: string;
  className?: string;
}

export function DiffViewer({ oldContent, newContent, className }: DiffViewerProps) {
  const lines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.type === "add") added++;
      else if (l.type === "remove") removed++;
    }
    return { added, removed };
  }, [lines]);

  const visible = useMemo(() => {
    const set = new Set<number>();
    lines.forEach((l, i) => {
      if (l.type !== "equal") {
        for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(lines.length - 1, i + CONTEXT_LINES); k++) {
          set.add(k);
        }
      }
    });
    return set;
  }, [lines]);

  const items: ViewItem[] = useMemo(() => {
    const result: ViewItem[] = [];
    let i = 0;
    while (i < lines.length) {
      if (visible.has(i) || expandedHunks.has(i)) {
        result.push({ kind: "line", line: lines[i]!, idx: i });
        i++;
      } else {
        let end = i;
        while (end < lines.length && !visible.has(end) && !expandedHunks.has(end)) {
          end++;
        }
        result.push({ kind: "collapsed", start: i, end, count: end - i });
        i = end;
      }
    }
    return result;
  }, [lines, visible, expandedHunks]);

  if (stats.added === 0 && stats.removed === 0) {
    return (
      <div className={`p-4 text-center text-xs text-(--dim) ${className ?? ""}`}>
        No changes between versions
      </div>
    );
  }

  const expandHunk = (start: number, end: number) => {
    setExpandedHunks((prev) => {
      const next = new Set(prev);
      for (let k = start; k < end; k++) next.add(k);
      return next;
    });
  };

  return (
    <div className={`overflow-auto font-mono text-[11px] leading-[1.6] ${className ?? ""}`}>
      <div className="flex items-center gap-2 px-3 py-1 border-b border-(--border) text-[10px]">
        {stats.added > 0 && <span className="text-green-400">+{stats.added}</span>}
        {stats.removed > 0 && <span className="text-red-400">-{stats.removed}</span>}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {items.map((item, i) => {
            if (item.kind === "collapsed") {
              return (
                <tr key={`c-${i}`}>
                  <td colSpan={4} className="text-center py-0.5">
                    <button
                      onClick={() => expandHunk(item.start, item.end)}
                      className="text-[10px] text-(--dim) hover:text-violet-300 transition-colors"
                    >
                      ↕ {item.count} unchanged lines
                    </button>
                  </td>
                </tr>
              );
            }
            const { line } = item;
            const bgClass =
              line.type === "add"
                ? "bg-green-500/20"
                : line.type === "remove"
                  ? "bg-red-500/20"
                  : "";
            const gutterBgClass =
              line.type === "add"
                ? "bg-green-500/30"
                : line.type === "remove"
                  ? "bg-red-500/30"
                  : "";
            const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
            const prefixClass =
              line.type === "add"
                ? "text-green-300 font-bold"
                : line.type === "remove"
                  ? "text-red-300 font-bold"
                  : "text-transparent";
            const contentClass =
              line.type === "add"
                ? "text-green-100"
                : line.type === "remove"
                  ? "text-red-100"
                  : "text-(--fg)";

            return (
              <tr key={`l-${i}`} className={bgClass}>
                <td className={`select-none text-right pr-1 pl-2 text-[10px] w-8 text-(--dim) align-top ${gutterBgClass}`}>
                  {line.oldLineNo ?? ""}
                </td>
                <td className={`select-none text-right pr-1 text-[10px] w-8 text-(--dim) align-top ${gutterBgClass}`}>
                  {line.newLineNo ?? ""}
                </td>
                <td className={`select-none w-4 text-center align-top ${prefixClass} ${gutterBgClass}`}>
                  {prefix}
                </td>
                <td className={`pr-4 whitespace-pre-wrap break-all ${contentClass}`}>
                  {line.content || "\u00A0"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
