import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { PreviewScroll } from "@/ui";
import { PREVIEW_HEIGHT_PX, type PreviewHeight } from "@/ui/preview-scroll";
import {
  ChevronRight,
  FilePenLine,
  FileText,
  Globe2,
  Search,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "@/ui/icon-registry";
import type { ToolBlock } from "@/features/agent/messages";
import { highlightLines } from "@/features/agent/highlight-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useAppStore } from "@/store";
import { FILESYSTEM_CHANGED_EVENT } from "@/lib/workspace-events";
import {
  FILE_WRITE_TOOL_NAMES,
  classifyTool,
  compactToolText,
  detectLang,
  extractFromArgs,
  extractPartialField,
  fileBasename,
  humanizeToolName,
  toolArg,
  toolKindNodeColor,
  toolPreviewHeightFor,
  toolVerb,
  type ToolKind,
} from "@/features/agent/ui/timeline/tool-metadata";
import {
  parseDiffPreview,
  type DiffPreviewLine,
} from "@/features/agent/ui/timeline/diff-preview-model";

const ToolPreviewHeightContext = createContext<PreviewHeight>("md");

function useToolPreviewHeight(): PreviewHeight {
  return useContext(ToolPreviewHeightContext);
}

export const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  edit: FilePenLine,
  search: Search,
  read: FileText,
  exec: TerminalSquare,
  browser: Globe2,
  generic: Wrench,
};

type ToolMeta = { verb: string; detail: string | null };

function toolMeta(block: ToolBlock, filePath?: string | null): ToolMeta {
  const path = toolArg(block, [
    "path",
    "file_path",
    "filePath",
    "file",
    "filename",
    "target_file",
    "uri",
    "ref_id",
  ]);
  const query = toolArg(block, ["query", "q", "pattern", "search", "search_query", "needle"]);
  const command = toolArg(block, ["cmd", "command", "script", "shell", "input"]);
  const url = toolArg(block, ["url", "href"]);
  const resolvedPath = filePath ?? path;
  const kind = classifyTool(block);
  const verb = toolVerb(block);

  switch (kind) {
    case "edit":
    case "read":
      return { verb, detail: resolvedPath ?? fileBasename(resolvedPath) };
    case "search": {
      const compact = compactToolText(query, 80);
      return { verb, detail: compact ? `for ${compact}` : (path ?? "files") };
    }
    case "exec":
      return { verb, detail: compactToolText(command, 110) ?? "command" };
    case "browser":
      return {
        verb: browserToolLabel(block),
        detail: compactToolText(url ?? browserToolDetail(block), 110),
      };
    default:
      return {
        verb,
        detail:
          [humanizeToolName(block.name), compactToolText(command ?? query ?? path ?? url, 80)]
            .filter(Boolean)
            .join(" · ") || null,
      };
  }
}

function browserToolLabel(block: ToolBlock): string {
  const running = block.status === "running";
  const normalized = block.name
    .toLowerCase()
    .replace(/^browser_/, "")
    .replace(/^chrome_/, "");
  if (normalized.includes("navigate")) return running ? "Navigating" : "Navigated";
  if (normalized.includes("get_text")) return running ? "Reading page" : "Read page";
  if (normalized.includes("get_html")) return running ? "Reading page" : "Read page";
  if (normalized.includes("screenshot")) return running ? "Taking screenshot" : "Took screenshot";
  if (normalized.includes("click")) return running ? "Clicking" : "Clicked";
  if (normalized.includes("fill")) return running ? "Filling field" : "Filled field";
  if (normalized.includes("scroll")) return running ? "Scrolling" : "Scrolled";
  if (normalized.includes("get_url")) return running ? "Checking URL" : "Checked URL";
  if (normalized.includes("history")) return running ? "Checking history" : "Checked history";
  return running ? "Using browser" : "Used browser";
}

function browserToolDetail(block: ToolBlock): string | null {
  const stringValue = toolArg(block, ["selector", "value", "tabId", "query"]);
  const deltaY = block.args?.deltaY;
  if (stringValue) return stringValue;
  if (typeof deltaY === "number") return `deltaY ${deltaY}`;
  return compactToolText(block.resultText, 110);
}

function ToolSummary({
  block,
  filePath,
  children,
  open = false,
}: {
  block: ToolBlock;
  filePath?: string | null;
  children?: ReactNode;
  open?: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const expanded = userOpen ?? open;
  const meta = toolMeta(block, filePath);
  const running = block.status === "running";
  const kind = classifyTool(block);
  const idleColor = toolKindNodeColor(kind);
  const Icon = TOOL_ICONS[kind];
  return (
    <details className="group min-w-0" open={expanded}>
      <summary
        className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setUserOpen(!expanded);
        }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-(--dim)/65" strokeWidth={1.7} />
        <span
          className={`shrink-0 text-[length:var(--fs-base)] font-normal leading-5 ${
            running ? "codex-shimmer-text" : idleColor
          }`}
        >
          {meta.verb}
        </span>
        {meta.detail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--codex-chat-code-font-size)] leading-5 text-(--hl2)">
            {meta.detail}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {block.status === "error" ? (
          <span className="shrink-0 text-[length:var(--fs-sm)] text-(--err)">failed</span>
        ) : null}
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-(--dim)/55 transition-transform group-open:rotate-90"
          strokeWidth={1.7}
        />
      </summary>
      {expanded && children ? <div className="mb-1.5 ml-1.5 mt-1 min-w-0">{children}</div> : null}
    </details>
  );
}

/* The shell block: a single flat terminal surface — `$ command` line, then
   dim scrollback-style output. Failure tints the prompt; no chips, no rows. */
function ShellBlock({
  command,
  output,
  status,
}: {
  command: string;
  output: string | null;
  status: ToolBlock["status"];
}) {
  const failed = status === "error";
  const trimmedOutput = output?.replace(/\s+$/, "") || null;
  const height = useToolPreviewHeight();
  return (
    <div
      className={`overflow-hidden rounded-md border bg-(--color-input) ${
        failed ? "border-(--err)/35" : "border-(--border)"
      }`}
    >
      <PreviewScroll
        height={height}
        className="px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6]"
      >
        <div className="flex items-start gap-2">
          <span
            className={`select-none ${failed ? "text-(--err)" : "text-(--color-terminal-green)"}`}
          >
            $
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-(--fg)/90">
            {command}
          </span>
        </div>
        {trimmedOutput ? (
          <pre className="mt-2 whitespace-pre-wrap break-words text-(--fg)/55">{trimmedOutput}</pre>
        ) : null}
      </PreviewScroll>
    </div>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  const height = useToolPreviewHeight();
  return (
    <PreviewScroll
      height={height}
      className="max-w-full rounded-md border border-(--border) bg-(--color-input)"
    >
      <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/65">
        {children}
      </pre>
    </PreviewScroll>
  );
}

function HighlightedToolSource({ body, lang }: { body: string; lang: string }) {
  const height = useToolPreviewHeight();
  const highlighted = useMemo(
    () => (lang ? highlightLines(lang, body.split("\n")).join("\n") : null),
    [body, lang],
  );
  return (
    <PreviewScroll height={height} stickToBottom={false} className="max-w-full">
      <pre className="px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/90">
        {highlighted !== null ? (
          <code
            className={`language-${lang} syntax-highlight`}
            dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
          />
        ) : (
          <code>{body || "\u00a0"}</code>
        )}
      </pre>
    </PreviewScroll>
  );
}

const DIFF_ROW_STYLES: Record<DiffPreviewLine["kind"], string> = {
  addition: "bg-(--ok)/[0.07]",
  context: "bg-transparent",
  deletion: "bg-(--err)/[0.065]",
  hunk: "border-y border-(--separator)/70 bg-(--fg)/[0.035] text-(--dim)",
  meta: "bg-(--fg)/[0.025] text-(--dim)/80",
};

const DIFF_MARKER_STYLES: Record<DiffPreviewLine["kind"], string> = {
  addition: "bg-(--ok)/[0.055] text-(--ok)",
  context: "text-(--dim)/35",
  deletion: "bg-(--err)/[0.05] text-(--err)",
  hunk: "text-(--dim)/45",
  meta: "text-(--dim)/45",
};

function DiffPreviewSource({ body, filePath }: { body: string; filePath?: string | null }) {
  const height = useToolPreviewHeight();
  const preview = useMemo(() => parseDiffPreview(body), [body]);
  const language = detectLang(filePath);
  const highlightedLines = useMemo(
    () =>
      language
        ? highlightLines(
            language,
            preview.lines.map((line) => line.content),
          )
        : null,
    [language, preview.lines],
  );
  return (
    <div className="overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
      <div className="flex h-7 items-center justify-between border-b border-(--separator) px-3 text-[length:var(--fs-xs)]">
        <span className="text-(--dim)">Changes</span>
        <span className="flex items-center gap-2 font-mono">
          <span className="text-(--ok)">+{preview.additions}</span>
          <span className="text-(--err)">−{preview.deletions}</span>
        </span>
      </div>
      <PreviewScroll height={height} stickToBottom={false}>
        {preview.lines.map((line, index) => {
          const highlighted =
            line.kind === "addition" || line.kind === "deletion" || line.kind === "context"
              ? highlightedLines?.[index]
              : undefined;
          return (
            <div
              key={`${index}:${line.kind}`}
              className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] font-mono text-[length:var(--fs-sm)] leading-5 ${DIFF_ROW_STYLES[line.kind]} ${line.content ? "min-h-5" : "h-3"}`}
            >
              <span
                className={`flex select-none items-start justify-center border-r border-(--separator)/45 ${DIFF_MARKER_STYLES[line.kind]}`}
              >
                {line.marker}
              </span>
              {highlighted !== undefined ? (
                <span
                  className="syntax-highlight min-w-0 whitespace-pre-wrap break-words px-3 text-(--fg)/82"
                  dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
                />
              ) : (
                <span className="min-w-0 whitespace-pre-wrap break-words px-3 text-(--fg)/82">
                  {line.content || "\u00a0"}
                </span>
              )}
            </div>
          );
        })}
      </PreviewScroll>
    </div>
  );
}

type FileWritePreviewData = {
  filePath: string | null;
  fileContent: string | null;
  patchContent: string | null;
};

type EditEntry = {
  oldText?: unknown;
  newText?: unknown;
};

function editsToDiff(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const hunks = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const edit = entry as EditEntry;
    const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
    const newText = typeof edit.newText === "string" ? edit.newText : "";
    if (!oldText && !newText) return [];
    const removed = oldText.split("\n").map((line) => `-${line}`);
    const added = newText.split("\n").map((line) => `+${line}`);
    return [`@@ edit ${index + 1} @@`, ...removed, ...added].join("\n");
  });
  return hunks.length ? hunks.join("\n") : null;
}

// Stream a diff preview out of partially-streamed args JSON. Some edit tools
// (str_replace_editor, apply_patch) emit `"old_str": "...`, `"new_str": "..."`
// fields before the surrounding object closes — find every such pair and
// render an incremental diff so the user sees the edit as it streams.
function partialEditsDiffFromArgsText(argsText: string | undefined): string | null {
  if (!argsText) return null;
  const oldKey = extractPartialField(argsText, ["old_str", "old_text", "oldText"]);
  const newKey = extractPartialField(argsText, ["new_str", "new_text", "newText", "replacement"]);
  if (oldKey === null && newKey === null) return null;
  const oldText = oldKey ?? "";
  const newText = newKey ?? "";
  if (!oldText && !newText) return null;
  const removed = oldText.split("\n").map((line: string) => `-${line}`);
  const added = newText.split("\n").map((line: string) => `+${line}`);
  return ["@@ edit @@", ...removed, ...added].join("\n");
}

function patchPreviewFromArgs(block: ToolBlock): string | null {
  const direct = extractFromArgs(block.args, block.argsText, ["patch", "diff"]);
  if (direct) return direct;
  const editsDiff = editsToDiff(block.args?.edits);
  if (editsDiff) return editsDiff;
  return (
    partialEditsDiffFromArgsText(block.argsText) ??
    (block.argsText ? extractFromArgs(undefined, block.argsText, ["edits"]) : null)
  );
}

function fileWritePreviewData(block: ToolBlock): FileWritePreviewData | null {
  const filePath = extractFromArgs(block.args, block.argsText, [
    "path",
    "file_path",
    "filePath",
    "file",
    "target_file",
    // The obsidian tools address a note, not a path on disk — same role here.
    "note",
  ]);
  const patchContent = patchPreviewFromArgs(block);
  const fileContent = patchContent
    ? null
    : extractFromArgs(block.args, block.argsText, [
        "content",
        "contents",
        "text",
        "body",
        "source",
        "payload",
        "newText",
        "new_text",
        "new_content",
        "new_str",
        "replacement",
        "insert",
      ]);

  if (fileContent === null && patchContent === null) return null;
  return { filePath, fileContent, patchContent };
}

function FileWritePreview({
  block,
  filePath,
  fileContent,
  patchContent,
}: {
  block: ToolBlock;
  filePath: string | null;
  fileContent: string | null;
  patchContent: string | null;
}) {
  const height = useToolPreviewHeight();
  const previewHeightPx = PREVIEW_HEIGHT_PX[height];
  const lang = detectLang(filePath);
  const body = fileContent ?? patchContent ?? "";
  const isSvg = /\.svg$/i.test(filePath ?? "") || /^\s*<svg[\s>]/i.test(body);
  const [showPreview, setShowPreview] = useState(isSvg);
  const sourceLang = fileContent === null && patchContent !== null ? "diff" : lang;

  return (
    <ToolSummary block={block} filePath={filePath} open>
      {patchContent ? (
        <DiffPreviewSource body={patchContent} filePath={filePath} />
      ) : (
        <div className="overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
          <div className="flex items-center justify-between gap-2 border-b border-(--separator) px-3 py-1.5 text-[length:var(--fs-sm)] text-(--dim)">
            <span className="truncate font-mono">
              {fileBasename(filePath) ?? sourceLang ?? "source"}
            </span>
            {isSvg ? (
              <button
                type="button"
                onClick={() => setShowPreview((value) => !value)}
                className="rounded-md px-1.5 py-0.5 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              >
                {showPreview ? "Source" : "Preview"}
              </button>
            ) : null}
          </div>
          {isSvg && showPreview ? (
            <div
              className="flex min-h-40 items-center justify-center overflow-auto bg-white p-4"
              style={{ height: previewHeightPx }}
            >
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(body)}`}
                alt={fileBasename(filePath) ?? "svg preview"}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <HighlightedToolSource body={body} lang={sourceLang} />
          )}
        </div>
      )}
      {block.resultText ? (
        <div className="mt-1.5">
          <ToolOutput>{block.resultText}</ToolOutput>
        </div>
      ) : null}
    </ToolSummary>
  );
}

function diffPreviewData(block: ToolBlock): string | null {
  const diffText =
    extractFromArgs(block.args, block.argsText, ["patch", "diff", "edits"]) ?? block.resultText;
  if (!diffText) return null;
  if (block.name.toLowerCase().includes("diff")) return diffText;
  if (/^(diff --git|@@\s+-|\+\+\+ |--- )/m.test(diffText)) return diffText;
  return null;
}

function DiffPreview({ block, diffText }: { block: ToolBlock; diffText: string }) {
  const filePath = toolArg(block, ["path", "file_path", "filePath", "file", "filename"]);
  return (
    <ToolSummary block={block} filePath={filePath} open>
      <DiffPreviewSource body={diffText} filePath={filePath} />
    </ToolSummary>
  );
}

function execCommand(block: ToolBlock): string | null {
  const command = extractFromArgs(block.args, block.argsText, [
    "cmd",
    "command",
    "script",
    "shell",
    "input",
  ]);
  return command && command.trim() ? command : null;
}

function BrowserPreview({ block }: { block: ToolBlock }) {
  const args = browserToolArgs(block);
  const display =
    compactBrowserResult(block.resultText) ||
    (block.text && block.text !== block.argsText ? compactBrowserResult(block.text) : null);
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {args ? (
        <div className="mb-1.5 rounded-md border border-(--border) bg-(--color-input) px-3 py-1.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/75">
          {args}
        </div>
      ) : null}
      {display ? <ToolOutput>{display}</ToolOutput> : null}
    </ToolSummary>
  );
}

function browserToolArgs(block: ToolBlock): string | null {
  if (!block.args || Object.keys(block.args).length === 0) return null;
  const pairs = Object.entries(block.args).flatMap(([key, value]) => {
    if (value === undefined || value === null || value === "") return [];
    const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
    return text ? [`${key}: ${text}`] : [];
  });
  return pairs.length ? pairs.join("  ") : null;
}

function compactBrowserResult(result: string | null | undefined): string | null {
  if (!result) return null;
  return compactToolText(result, 1200);
}

function ToolPreviewHeightProvider({ kind, children }: { kind: ToolKind; children: ReactNode }) {
  const defaultHeight = useAppStore((state) => state.toolPreviewHeight);
  const overrides = useAppStore((state) => state.toolPreviewHeightOverrides);
  const height = toolPreviewHeightFor(kind, defaultHeight, overrides);
  return (
    <ToolPreviewHeightContext.Provider value={height}>{children}</ToolPreviewHeightContext.Provider>
  );
}

export function ToolBlockView({ block }: { block: ToolBlock }) {
  useFilesystemRefresh(block);
  const kind = classifyTool(block);
  const fileWritePreview = FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase())
    ? fileWritePreviewData(block)
    : null;
  if (fileWritePreview) {
    return (
      <ToolPreviewHeightProvider kind={kind}>
        <FileWritePreview block={block} {...fileWritePreview} />
      </ToolPreviewHeightProvider>
    );
  }
  const diffPreview = diffPreviewData(block);
  if (diffPreview) {
    return (
      <ToolPreviewHeightProvider kind={kind}>
        <DiffPreview block={block} diffText={diffPreview} />
      </ToolPreviewHeightProvider>
    );
  }
  if (kind === "exec") {
    const command = execCommand(block);
    if (command) {
      return (
        <ToolPreviewHeightProvider kind={kind}>
          <ToolSummary block={block} open={block.status === "running"}>
            <ShellBlock command={command} output={block.resultText || null} status={block.status} />
          </ToolSummary>
        </ToolPreviewHeightProvider>
      );
    }
  }
  if (kind === "browser") {
    return (
      <ToolPreviewHeightProvider kind={kind}>
        <BrowserPreview block={block} />
      </ToolPreviewHeightProvider>
    );
  }

  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolPreviewHeightProvider kind={kind}>
      <ToolSummary block={block} open={block.status === "running"}>
        {display ? <ToolOutput>{display}</ToolOutput> : null}
      </ToolSummary>
    </ToolPreviewHeightProvider>
  );
}

function useFilesystemRefresh(block: ToolBlock): void {
  const refreshesFilesystem =
    FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase()) || classifyTool(block) === "exec";
  useMountSubscription(() => {
    if (block.status !== "done" || !refreshesFilesystem) return;
    window.dispatchEvent(new Event(FILESYSTEM_CHANGED_EVENT));
  }, [block.id, block.status, refreshesFilesystem]);
}
