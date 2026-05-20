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
import { ChevronDownIcon, GlobeIcon } from "@/components/icons";
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

function iconForKind(kind: ToolKind): ReactNode {
  switch (kind) {
    case "edit":
      return <PencilLine className="h-3 w-3" />;
    case "search":
      return <Search className="h-3 w-3" />;
    case "read":
      return <FileText className="h-3 w-3" />;
    case "exec":
      return <TerminalSquare className="h-3 w-3" />;
    case "browser":
      return <GlobeIcon className="h-3 w-3" />;
    default:
      return <Wrench className="h-3 w-3" />;
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
      return { icon, label: "Used browser", detail: compactToolText(url, 110) };
    default:
      return {
        icon,
        label: humanizeToolName(block.name),
        detail: compactToolText(command ?? query ?? path ?? url, 110),
      };
  }
}

function ToolStatus({ status }: { status: ToolBlock["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-(--accent)">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-(--err)">
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
      <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded-md px-1.5 py-1 text-(--fg) hover:bg-(--hover) [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-(--fg)/75">
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] leading-5 text-(--fg)/90">
            {meta.label}
          </span>
          {meta.detail ? (
            <span className="block truncate font-mono text-[10px] leading-4 text-(--fg)/60">
              {meta.detail}
            </span>
          ) : null}
        </span>
        <ToolStatus status={block.status} />
        {children ? (
          <ChevronDownIcon className="mt-0.5 h-3 w-3 shrink-0 text-(--fg)/60 transition-transform group-open:rotate-180" />
        ) : null}
      </summary>
      {children ? <div className="ml-5 mt-1 min-w-0">{children}</div> : null}
    </details>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[320px] max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5 text-(--fg)/70 [overflow-wrap:anywhere]">
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
    "max-h-[420px] max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md border border-(--border)/60 bg-(--surface)/30 p-2 font-mono text-[10.5px] leading-5 text-(--fg) [overflow-wrap:anywhere]";

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
    <ToolSummary block={block} filePath={filePath} open={block.status === "running"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-(--dim)">
        <span>{sourceLang || "source"}</span>
        {isHtml ? (
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="rounded-md px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          >
            {showPreview ? "Source" : "Preview"}
          </button>
        ) : null}
      </div>
      {isHtml && showPreview ? (
        <iframe
          sandbox=""
          srcDoc={body}
          className="h-72 w-full rounded-md border border-(--border) bg-white"
          title={filePath ?? "preview"}
        />
      ) : (
        <HighlightedToolSource body={body} lang={sourceLang} />
      )}
      {block.resultText ? (
        <div className="mt-1 font-mono text-[10px] text-(--dim)">
          <ToolOutput>{block.resultText}</ToolOutput>
        </div>
      ) : null}
    </ToolSummary>
  );
}

export function ToolBlockView({ block }: { block: ToolBlock }) {
  const fileWritePreview = FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase())
    ? fileWritePreviewData(block)
    : null;
  if (fileWritePreview) {
    return <FileWritePreview block={block} {...fileWritePreview} />;
  }

  // Generic fallback (shells, reads, searches, browser tools, etc.).
  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {display ? <ToolOutput>{display}</ToolOutput> : null}
    </ToolSummary>
  );
}
