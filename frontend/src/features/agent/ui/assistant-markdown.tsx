"use client";

import React, {
  Children,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "@/ui/icon-registry";
import {
  escapeHighlightHtml,
  highlightFenced,
  peekHighlightFenced,
} from "@/features/agent/highlight-cache";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { useToolsActions } from "@/features/agent/tools/context";
import { CopyablePathChip } from "@/features/agent/ui/copyable-path-chip";

const FILE_REF_PATTERN =
  /^(?:file:\/\/|~\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`'")]+(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)(?::\d+(?::\d+)?)?$/;

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
  return "";
}

function isFileReference(value: string | undefined): value is string {
  if (!value) return false;
  const clean = value.trim();
  if (/^https?:\/\//i.test(clean)) return false;
  return FILE_REF_PATTERN.test(clean);
}

class MarkdownErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, markCopied] = useCopiedFlag();
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(code).then(markCopied, () => undefined);
  }, [code, markCopied]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded px-1 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function codeLanguage(children: ReactNode): string | null {
  const codeElement = Children.toArray(children).find(
    (child) =>
      isValidElement<{ className?: string }>(child) &&
      typeof child.props.className === "string" &&
      /\blanguage-/.test(child.props.className),
  );
  if (!isValidElement<{ className?: string }>(codeElement)) return null;
  const match = /\blanguage-([^\s]+)/.exec(codeElement.props.className ?? "");
  return match ? match[1] : null;
}

const HIGHLIGHT_SETTLE_MS = 150;

const FencedCodeBlock = memo(function FencedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  // A block that was highlighted before renders its cached HTML immediately.
  // A new (usually still-streaming) block renders escaped plaintext and only
  // runs hljs once its text stops changing for a beat — per-frame cost stays
  // O(escape) instead of O(tokenize whole block), and the highlight LRU never
  // fills up with partial snapshots.
  const cached = peekHighlightFenced(language, code);
  const [settled, setSettled] = useState<{ code: string; html: string } | null>(null);
  useMountSubscription(() => {
    if (cached !== undefined) return;
    const timer = window.setTimeout(() => {
      setSettled({ code, html: highlightFenced(language, code) });
    }, HIGHLIGHT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [cached === undefined, code, language]);
  const highlightedHtml =
    cached ?? (settled && settled.code === code ? settled.html : escapeHighlightHtml(code));
  const codeClassName = [
    "syntax-highlight",
    "hljs",
    language ? `language-${language}` : "",
    "font-mono",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="assistant-code-block group my-3 overflow-hidden rounded-xl border border-(--border) bg-(--color-surface)">
      <div className="flex h-8 items-center justify-between border-b border-(--border) px-3">
        <span className="font-mono text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.1em] text-(--dim)">
          {language ?? "code"}
        </span>
        {code ? <CodeBlockCopyButton code={code} /> : null}
      </div>
      <pre className="m-0 max-w-full overflow-x-auto bg-transparent px-4 py-3 text-[length:var(--codex-chat-code-font-size)] leading-[1.5]">
        <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
});
FencedCodeBlock.displayName = "FencedCodeBlock";

/* Codex prose scale: 14px body at 1.625 leading, headings 18/16/14/13
   semibold, 12px between blocks. */
const components: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1
      className="mb-2 mt-5 text-[18px] font-semibold leading-tight tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2
      className="mb-1.5 mt-4 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3
      className="mb-1.5 mt-3.5 text-[14px] font-semibold leading-snug tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4 className="mb-1 mt-3 text-[13px] font-semibold leading-snug text-(--fg)" {...props} />
  ),
  p: ({ node: _n, ...props }) => (
    <p
      className="my-3 max-w-full break-words text-[length:var(--codex-chat-font-size)] leading-[1.5] tracking-normal first:mt-0 last:mb-0 [overflow-wrap:anywhere]"
      {...props}
    />
  ),
  ul: ({ node: _n, ...props }) => <ul className="my-2 list-disc pl-4" {...props} />,
  ol: ({ node: _n, ...props }) => <ol className="my-2 list-decimal pl-4" {...props} />,
  li: ({ node: _n, ...props }) => (
    <li
      className="text-[length:var(--codex-chat-font-size)] leading-[1.5] tracking-normal"
      {...props}
    />
  ),
  code: ({ node: _n, className, children, ...props }) => {
    const isBlock = typeof className === "string" && /\blanguage-/.test(className);
    if (isBlock) {
      return (
        <code className={`${className ?? ""} font-mono`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded-[var(--rad-sm)] bg-(--fg)/10 px-1.5 py-0.5 font-mono text-[length:var(--codex-chat-code-font-size)] leading-[1.4] text-(--fg)/88 [overflow-wrap:anywhere]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _n, children }) => {
    const code = nodeToPlainText(
      Children.toArray(children).find(
        (child) => isValidElement(child) && (child as { type?: string }).type === "code",
      ) ?? children,
    );
    const language = codeLanguage(children);
    return <FencedCodeBlock code={code} language={language} />;
  },
  a: ({ node: _n, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-(--link) underline underline-offset-2 hover:opacity-80"
    />
  ),
  blockquote: ({ node: _n, ...props }) => (
    <blockquote className="my-3 border-l-2 border-(--separator) pl-4 text-(--fg)/65" {...props} />
  ),
  hr: ({ node: _n, ...props }) => <hr className="my-3 border-(--border)" {...props} />,
  // Cells/rows are styled entirely via `.chat-markdown` in chat.css; only the
  // scroll wrapper needs a component override.
  table: ({ node: _n, ...props }) => (
    <div className="my-3 max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

// The remark/rehype plugin lists are constant. Hoisted out of render so the
// `ReactMarkdown` reconciler sees the same array identity each commit.
const REMARK_PLUGINS = [remarkGfm];

// Repair a single emphasis run whose closing delimiter has a stray leading
// space (`**text **`), which CommonMark won't parse as bold. Two guards keep us
// from collapsing the space *between* two adjacent runs:
//   1. the content must START with a non-space, non-delimiter char, so we anchor
//      on a real opener rather than a previous run's closing `**` — blocks
//      `**a** and **b**` (gap starts with a space);
//   2. the trailing `**` must NOT be immediately followed by a word or `*` char,
//      otherwise it's the OPENER of the next run, not a closer — blocks
//      `**a**, **b**` (gap starts with punctuation).
// Only spaces/tabs are stripped (not newlines), since the symptom is a lost
// inline space.
function normalizeLooseMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^\s*][^\n*]*?)[ \t]+\*\*(?![*\w])/g, "**$1**")
    .replace(/__([^\s_][^\n_]*?)[ \t]+__(?![_\w])/g, "__$1__");
}

type ToolHandlers = {
  setComputerOpen: (open: boolean) => void;
  setComputerTab: (tab: "browser" | "files" | "status" | "canvas") => void;
  setBrowserUrl: (url: string, input?: string) => void;
};

function buildComponentsWithAppLinks(tools: ToolHandlers): Components {
  // Open a referenced file or URL in the in-app sidepanel browser. Local paths
  // resolve to a file:// URL the browser renders directly; the chip's copy
  // button stays independent (it only copies the raw path/link).
  const openInBrowser = (raw: string) => {
    const cleaned = raw
      .trim()
      .replace(/^`+|`+$/g, "")
      .replace(/:\d+(?::\d+)?$/, "");
    const next = normalizeBrowserInput(cleaned, "");
    if (!next) return;
    tools.setComputerOpen(true);
    tools.setComputerTab("browser");
    tools.setBrowserUrl(next, next);
  };
  return {
    ...components,
    code: ({ node: _n, className, children, ...props }) => {
      const isBlock = typeof className === "string" && /\blanguage-/.test(className);
      if (isBlock) {
        return (
          <code className={`${className ?? ""} font-mono`} {...props}>
            {children}
          </code>
        );
      }
      const value = nodeToPlainText(children).trim();
      if (isFileReference(value)) {
        return (
          <CopyablePathChip value={value} onOpen={openInBrowser}>
            {children}
          </CopyablePathChip>
        );
      }
      return <code {...props}>{children}</code>;
    },
    a: ({ node: _n, href, children, ...props }) => {
      const fileHref = typeof href === "string" && isFileReference(href);
      if (fileHref) {
        return (
          <CopyablePathChip value={href} onOpen={openInBrowser}>
            {children}
          </CopyablePathChip>
        );
      }
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (!href) return;
            const next = normalizeBrowserInput(href, "");
            if (!next) return;
            event.preventDefault();
            tools.setComputerOpen(true);
            tools.setComputerTab("browser");
            tools.setBrowserUrl(next, next);
          }}
          className="chat-ref-chip"
          title={href}
        >
          <ExternalLink className="chat-ref-chip-icon" aria-hidden />
          <span className="chat-ref-chip-label">{children}</span>
        </a>
      );
    },
  };
}

function AssistantMarkdownInner({ text }: { text: string }) {
  // Actions-only subscription: tools state churn (browser typing, canvas
  // streaming, selections) never re-renders frozen markdown blocks.
  const tools = useToolsActions();
  const normalizedText = useMemo(() => normalizeLooseMarkdownEmphasis(text), [text]);
  // Stable `components` map: only changes when any of the tool callbacks it
  // captures changes identity (they're useCallback-stable in ToolsProvider).
  const componentsWithAppLinks = useMemo<Components>(
    () =>
      buildComponentsWithAppLinks({
        setComputerOpen: tools.setComputerOpen,
        setComputerTab: tools.setComputerTab,
        setBrowserUrl: tools.setBrowserUrl,
      }),
    [tools.setComputerOpen, tools.setComputerTab, tools.setBrowserUrl],
  );
  return (
    <div className="chat-markdown min-w-0 max-w-full overflow-x-hidden text-[length:var(--fs-md)] leading-[18px] tracking-normal [overflow-wrap:anywhere]">
      <MarkdownErrorBoundary
        fallback={
          <pre className="max-w-full whitespace-pre-wrap break-words text-[length:var(--fs-md)] leading-[19.2px] tracking-normal [font-family:var(--codex-chat-font-family)] [font-weight:var(--codex-chat-font-weight)] [overflow-wrap:anywhere]">
            {normalizedText}
          </pre>
        }
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={componentsWithAppLinks}>
          {normalizedText}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
}

// React.memo on `text` lets prior text blocks skip re-rendering entirely once
// they're frozen. The streaming text block keeps changing identity per delta
// (via appendDelta), which still re-renders correctly through this memo.
export const AssistantMarkdown = memo(AssistantMarkdownInner);
AssistantMarkdown.displayName = "AssistantMarkdown";
