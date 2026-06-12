import { useMemo, useState, type ReactNode } from "react";
import { highlightFenced } from "@/features/agent/highlight-cache";
import type { ToolBlock } from "@/features/agent/messages";
import {
  FILE_WRITE_TOOL_NAMES,
  classifyTool,
  compactToolText,
  detectLang,
  extractFromArgs,
  fileBasename,
  humanizeToolName,
  toolArg,
  toolVerb,
} from "@/features/agent/ui/timeline/tool-metadata";

/* Codex action rows: a one-line `<verb> <detail>` pair — the verb carries the
   emphasis and morphs tense with status, the detail is muted monospace. No
   icons, no badges; a running call shimmers its verb, a failed one appends a
   quiet red "failed". Expanding a row reveals the full payload (shell block,
   file source, diff, raw output). */

type ToolMeta = { verb: string; detail: string | null };

function previewHtmlDocument(source: string): string {
  const resetStyle = "<style>html,body{margin:0;padding:0}</style>";
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1>${resetStyle}`);
  if (/<html[\s>]/i.test(source))
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${resetStyle}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${resetStyle}</head><body>${source}</body></html>`;
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
    .replace(/^parchi_/, "");
  if (normalized.includes("navigate")) return running ? "Navigating" : "Navigated";
  if (normalized.includes("get_text")) return running ? "Reading page" : "Read page";
  if (normalized.includes("get_html")) return running ? "Reading page" : "Read page";
  if (normalized.includes("screenshot")) return running ? "Taking screenshot" : "Took screenshot";
  if (normalized.includes("click")) return running ? "Clicking" : "Clicked";
  if (normalized.includes("fill")) return running ? "Filling field" : "Filled field";
  if (normalized.includes("scroll")) return running ? "Scrolling" : "Scrolled";
  if (normalized.includes("get_url")) return running ? "Checking URL" : "Checked URL";
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
  const meta = toolMeta(block, filePath);
  const running = block.status === "running";
  return (
    <details className="group min-w-0" open={open}>
      <summary className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden">
        <span
          className={`shrink-0 text-[13px] font-medium leading-5 ${
            running ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {meta.verb}
        </span>
        {meta.detail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--codex-chat-code-font-size)] leading-5 text-(--dim)/80">
            {meta.detail}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {block.status === "error" ? (
          <span className="shrink-0 text-[length:var(--fs-sm)] text-(--err)">failed</span>
        ) : null}
      </summary>
      {children ? <div className="mb-1.5 ml-1.5 mt-1 min-w-0">{children}</div> : null}
    </details>
  );
}

/* The Codex shell block: faint-bordered surface, `$ command` line, output
   under a hairline, and a Success / Failed chip in the footer. */
function ShellBlock({
  command,
  output,
  status,
}: {
  command: string;
  output: string | null;
  status: ToolBlock["status"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-(--border)/60 bg-(--surface)/50">
      <div className="flex items-start gap-2 px-3 py-2 font-mono text-[length:var(--codex-chat-code-font-size)] leading-relaxed text-(--fg)/85">
        <span className="select-none text-(--dim)/70">$</span>
        <span className="min-w-0 whitespace-pre-wrap break-words">{command}</span>
      </div>
      {output ? (
        <pre className="max-h-[320px] overflow-auto border-t border-(--border)/40 px-3 py-2 font-mono text-[length:var(--codex-chat-code-font-size)] leading-relaxed text-(--fg)/60">
          {output}
        </pre>
      ) : status !== "running" ? (
        <div className="border-t border-(--border)/40 px-3 py-1.5 font-mono text-[length:var(--codex-chat-code-font-size)] text-(--dim)/60">
          No output
        </div>
      ) : null}
      {status === "done" ? (
        <div className="border-t border-(--border)/40 px-3 py-1 text-[length:var(--fs-sm)] font-medium text-(--ok)">
          Success
        </div>
      ) : status === "error" ? (
        <div className="border-t border-(--border)/40 px-3 py-1 text-[length:var(--fs-sm)] font-medium text-(--err)">
          Failed
        </div>
      ) : null}
    </div>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[320px] max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-(--border)/40 bg-(--surface)/40 px-3 py-2 font-mono text-[length:var(--codex-chat-code-font-size)] leading-relaxed text-(--fg)/60">
      {children}
    </pre>
  );
}

function HighlightedToolSource({ body, lang }: { body: string; lang: string }) {
  // Shares the curated highlight.js core instance (a dozen languages) via the
  // memoizing cache — using the full `highlight.js` package here pulled ~190
  // languages (≈1 MB) into the agent route bundle.
  const highlighted = useMemo(() => (body ? highlightFenced(lang || null, body) : ""), [body, lang]);

  const className =
    "max-h-[420px] max-w-full overflow-auto px-3 py-2 font-mono text-[length:var(--codex-chat-code-font-size)] leading-relaxed text-(--fg)";

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
      <div className="overflow-hidden rounded-lg border border-(--border)/60 bg-(--surface)/50">
        <div className="flex items-center justify-between gap-2 border-b border-(--border)/40 px-3 py-1.5 text-[length:var(--fs-sm)] text-(--dim)">
          <span className="truncate font-mono">
            {fileBasename(filePath) ?? sourceLang ?? "source"}
          </span>
          {isHtml ? (
            <button
              type="button"
              onClick={() => setShowPreview((value) => !value)}
              className="rounded-md px-1.5 py-0.5 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
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
            className="m-0 h-72 w-full border-0 bg-white p-0"
            title={filePath ?? "preview"}
          />
        ) : (
          <HighlightedToolSource body={body} lang={sourceLang} />
        )}
      </div>
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
      <div className="overflow-hidden rounded-lg border border-(--border)/60 bg-(--surface)/50">
        <HighlightedToolSource body={diffText} lang="diff" />
      </div>
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
        <div className="mb-1.5 rounded-md border border-(--border)/45 bg-(--surface)/30 px-2 py-1 font-mono text-[length:var(--codex-chat-code-font-size)] text-(--fg)/75">
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
      return (
        <ToolSummary block={block} open={block.status === "running"}>
          <ShellBlock command={command} output={block.resultText || null} status={block.status} />
        </ToolSummary>
      );
    }
  }
  if (classifyTool(block) === "browser") {
    return <BrowserPreview block={block} />;
  }

  // Generic fallback (reads, searches, MCP tools, etc.).
  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {display ? <ToolOutput>{display}</ToolOutput> : null}
    </ToolSummary>
  );
}
