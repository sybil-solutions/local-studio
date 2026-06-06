import { useMemo, useState, type ReactNode } from "react";
import hljs from "highlight.js";
import {
  AlertTriangle,
  FileText,
  Loader2,
  PencilLine,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { GlobeIcon } from "@/ui/icons";
import type { ToolBlock } from "@/lib/agent/session";
import {
  FILE_WRITE_TOOL_NAMES,
  classifyTool,
  compactToolText,
  detectLang,
  extractFromArgs,
  fileBasename,
  humanizeToolName,
  toolArg,
  type ToolKind,
} from "./tool-metadata";

type ToolMeta = { icon: ReactNode; label: string; detail: string | null };

function previewHtmlDocument(source: string): string {
  const resetStyle = "<style>html,body{margin:0;padding:0}</style>";
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1>${resetStyle}`);
  if (/<html[\s>]/i.test(source))
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${resetStyle}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${resetStyle}</head><body>${source}</body></html>`;
}

function iconForKind(kind: ToolKind): ReactNode {
  switch (kind) {
    case "edit":
      return <PencilLine className="h-3.5 w-3.5" />;
    case "search":
      return <Search className="h-3.5 w-3.5" />;
    case "read":
      return <FileText className="h-3.5 w-3.5" />;
    case "exec":
      return <TerminalSquare className="h-3.5 w-3.5" />;
    case "browser":
      return <GlobeIcon className="h-3.5 w-3.5" />;
    default:
      return <Wrench className="h-3.5 w-3.5" />;
  }
}

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
  const basename = fileBasename(resolvedPath);
  const kind = classifyTool(block);
  const icon = iconForKind(kind);

  switch (kind) {
    case "edit":
      return {
        icon,
        label: basename ? `Edited ${basename}` : humanizeToolName(block.name),
        detail: resolvedPath && basename !== resolvedPath ? resolvedPath : null,
      };
    case "search": {
      const compact = compactToolText(query, 80);
      return {
        icon,
        label: compact ? `Searched for ${compact}` : "Searched files",
        detail: path && !query ? path : null,
      };
    }
    case "read":
      return {
        icon,
        label: basename ? `Read ${basename}` : humanizeToolName(block.name),
        detail: resolvedPath && basename !== resolvedPath ? resolvedPath : null,
      };
    case "exec":
      return { icon, label: "Ran command", detail: compactToolText(command, 110) };
    case "browser":
      return {
        icon,
        label: browserToolLabel(block.name),
        detail: compactToolText(url ?? browserToolDetail(block), 110),
      };
    default:
      return {
        icon,
        label: humanizeToolName(block.name),
        detail: compactToolText(command ?? query ?? path ?? url, 110),
      };
  }
}

function browserToolLabel(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/^browser_/, "")
    .replace(/^parchi_/, "");
  if (normalized.includes("navigate")) return "Browser navigated";
  if (normalized.includes("get_text")) return "Browser read text";
  if (normalized.includes("get_html")) return "Browser read HTML";
  if (normalized.includes("screenshot")) return "Browser captured screenshot";
  if (normalized.includes("click")) return "Browser clicked";
  if (normalized.includes("fill")) return "Browser filled field";
  if (normalized.includes("scroll")) return "Browser scrolled";
  if (normalized.includes("get_url")) return "Browser checked URL";
  return "Used browser";
}

function browserToolDetail(block: ToolBlock): string | null {
  const stringValue = toolArg(block, ["selector", "value", "tabId", "query"]);
  const deltaY = block.args?.deltaY;
  if (stringValue) return stringValue;
  if (typeof deltaY === "number") return `deltaY ${deltaY}`;
  return compactToolText(block.resultText, 110);
}

function ToolStatus({ status }: { status: ToolBlock["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[length:var(--fs-xs)] text-(--accent)">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[length:var(--fs-xs)] text-(--err)">
        <AlertTriangle className="h-3 w-3" />
        error
      </span>
    );
  }
  return null;
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
  const meta = toolMeta(block, filePath);
  return (
    <details className="group py-0.5" open={open}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-(--dim) transition-colors hover:text-(--fg) [&::-webkit-details-marker]:hidden">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-(--dim)">
          {meta.icon}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 truncate text-[length:var(--fs-xs)] font-medium leading-4 text-(--fg)/90">
            {meta.label}
          </span>
          {meta.detail ? (
            <span className="min-w-0 flex-1 truncate text-[length:var(--fs-xs)] leading-4 text-(--dim)">
              {meta.detail}
            </span>
          ) : null}
        </span>
        <ToolStatus status={block.status} />
      </summary>
      {children ? <div className="ml-6 mt-1 min-w-0">{children}</div> : null}
    </details>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[320px] max-w-full overflow-auto whitespace-pre font-mono text-[length:var(--fs-xs)] leading-4 text-(--fg)/70">
      {children}
    </pre>
  );
}

function HighlightedToolSource({ body, lang }: { body: string; lang: string }) {
  const highlighted = useMemo(() => {
    if (!body) return "";
    try {
      const result =
        lang && hljs.getLanguage(lang) ? hljs.highlight(body, { language: lang }) : null;
      return result ? result.value : hljs.highlightAuto(body).value;
    } catch {
      return null;
    }
  }, [body, lang]);

  const className =
    "max-h-[420px] max-w-full overflow-auto rounded-lg border border-(--border)/50 bg-(--surface)/35 p-3 font-mono text-[length:var(--fs-xs)] leading-4 text-(--fg)";

  if (highlighted === null) {
    return <pre className={className}>{body}</pre>;
  }

  return (
    <pre className={className}>
      <code
        className={lang ? `language-${lang}` : undefined}
        dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
      />
    </pre>
  );
}

type FileWritePreviewData = {
  filePath: string | null;
  fileContent: string | null;
  patchContent: string | null;
};

function fileWritePreviewData(block: ToolBlock): FileWritePreviewData | null {
  const filePath = extractFromArgs(block.args, block.argsText, [
    "path",
    "file_path",
    "filePath",
    "file",
  ]);
  const fileContent = extractFromArgs(block.args, block.argsText, [
    "content",
    "text",
    "newText",
    "new_content",
  ]);
  const patchContent = extractFromArgs(block.args, block.argsText, ["patch", "diff", "edits"]);

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
  const lang = detectLang(filePath);
  const isHtml = lang === "html";
  const [showPreview, setShowPreview] = useState(false);
  const body = fileContent ?? patchContent ?? "";
  const sourceLang = fileContent === null && patchContent !== null ? "diff" : lang;

  return (
    <ToolSummary block={block} filePath={filePath} open>
      <div className="mb-1 flex items-center justify-between gap-2 text-[length:var(--fs-xs)] uppercase tracking-[0.08em] text-(--dim)">
        <span>{sourceLang || "source"}</span>
        {isHtml ? (
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="rounded-md px-1.5 py-0.5 text-[length:var(--fs-xs)] normal-case tracking-normal text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          >
            {showPreview ? "Source" : "Preview"}
          </button>
        ) : null}
      </div>
      {isHtml && showPreview ? (
        <iframe
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={previewHtmlDocument(body)}
          className="m-0 h-72 w-full rounded-md border border-(--border) bg-white p-0"
          title={filePath ?? "preview"}
        />
      ) : (
        <HighlightedToolSource body={body} lang={sourceLang} />
      )}
      {block.resultText ? (
        <div className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
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
      <div className="mb-1 text-[length:var(--fs-xs)] uppercase tracking-[0.08em] text-(--dim)">
        diff
      </div>
      <HighlightedToolSource body={diffText} lang="diff" />
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

function ExecPreview({ block, command }: { block: ToolBlock; command: string }) {
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      <div className="mb-1 text-[length:var(--fs-xs)] uppercase tracking-[0.08em] text-(--dim)">
        bash
      </div>
      <HighlightedToolSource body={command} lang="bash" />
      {block.resultText ? (
        <div className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          <ToolOutput>{block.resultText}</ToolOutput>
        </div>
      ) : null}
    </ToolSummary>
  );
}

function BrowserPreview({ block }: { block: ToolBlock }) {
  const args = browserToolArgs(block);
  const display =
    compactBrowserResult(block.resultText) ||
    (block.text && block.text !== block.argsText ? compactBrowserResult(block.text) : null);
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {args ? (
        <div className="mb-1 rounded-md border border-(--border)/45 bg-(--surface)/30 px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--fg)/75">
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

export function ToolBlockView({ block }: { block: ToolBlock }) {
  const fileWritePreview = FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase())
    ? fileWritePreviewData(block)
    : null;
  if (fileWritePreview) {
    return <FileWritePreview block={block} {...fileWritePreview} />;
  }
  const diffPreview = diffPreviewData(block);
  if (diffPreview) {
    return <DiffPreview block={block} diffText={diffPreview} />;
  }
  if (classifyTool(block) === "exec") {
    const command = execCommand(block);
    if (command) {
      return <ExecPreview block={block} command={command} />;
    }
  }
  if (classifyTool(block) === "browser") {
    return <BrowserPreview block={block} />;
  }

  // Generic fallback (reads, searches, browser tools, etc.).
  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {display ? <ToolOutput>{display}</ToolOutput> : null}
    </ToolSummary>
  );
}
