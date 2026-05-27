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
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileText } from "lucide-react";
import { highlightFenced } from "@/lib/agent/highlight-cache";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools } from "@/lib/agent/tools/context";

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
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  }, [code]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded px-1 text-[10px] text-(--dim) hover:text-(--fg)"
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

const FencedCodeBlock = memo(function FencedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const highlightedHtml = useMemo(() => highlightFenced(language, code), [code, language]);
  const codeClassName = ["hljs", language ? `language-${language}` : "", "font-mono"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="assistant-code-block group my-3 overflow-hidden rounded-xl border border-(--border)/40 bg-[#1e1e1e]">
      <div className="flex h-8 items-center justify-between border-b border-(--border)/30 bg-(--surface)/40 px-3">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-(--dim)">
          {language ?? "code"}
        </span>
        {code ? <CodeBlockCopyButton code={code} /> : null}
      </div>
      <pre className="m-0 max-w-full overflow-x-auto bg-transparent px-3.5 py-2.5 text-[9.6px] leading-[1.6]">
        <code className={codeClassName} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
});
FencedCodeBlock.displayName = "FencedCodeBlock";

const components: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1
      className="mb-2 mt-5 text-[14.4px] font-semibold leading-tight tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2
      className="mb-1.5 mt-4 text-[12px] font-semibold leading-snug tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3
      className="mb-1.5 mt-3.5 text-[11.2px] font-semibold leading-snug tracking-[-0.01em] text-(--fg) first:mt-0"
      {...props}
    />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4 className="mb-1 mt-3 text-[10.4px] font-semibold leading-snug text-(--fg)" {...props} />
  ),
  p: ({ node: _n, ...props }) => (
    <p
      className="my-2.5 max-w-full break-words text-[10.4px] leading-[1.6] tracking-normal first:mt-0 last:mb-0 [overflow-wrap:anywhere]"
      {...props}
    />
  ),
  ul: ({ node: _n, ...props }) => <ul className="my-2 list-disc pl-5" {...props} />,
  ol: ({ node: _n, ...props }) => <ol className="my-2 list-decimal pl-5" {...props} />,
  li: ({ node: _n, ...props }) => (
    <li className="text-[10.4px] leading-[1.6] tracking-normal" {...props} />
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
        className="rounded-md bg-(--surface-2)/60 px-[5px] py-[1px] font-mono text-[10px] leading-[14.4px] text-(--fg)/85 [overflow-wrap:anywhere]"
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
      className="text-(--accent) underline underline-offset-2 hover:opacity-80"
    />
  ),
  blockquote: ({ node: _n, ...props }) => (
    <blockquote className="my-2 border-l-2 border-(--border) pl-3 italic text-(--dim)" {...props} />
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

type ToolHandlers = {
  requestFileOpen: (path: string) => void;
  setComputerOpen: (open: boolean) => void;
  setComputerTab: (tab: "browser" | "files" | "status" | "canvas") => void;
  setBrowserUrl: (url: string, input?: string) => void;
};

function buildComponentsWithAppLinks(tools: ToolHandlers): Components {
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
          <button
            type="button"
            onClick={() => tools.requestFileOpen(value)}
            className="chat-ref-chip"
            title={`Open ${value}`}
          >
            <FileText className="chat-ref-chip-icon" aria-hidden />
            <span className="chat-ref-chip-label">{children}</span>
          </button>
        );
      }
      return <code {...props}>{children}</code>;
    },
    a: ({ node: _n, href, children, ...props }) => {
      const fileHref = typeof href === "string" && isFileReference(href);
      return (
        <a
          {...props}
          href={href}
          target={fileHref ? undefined : "_blank"}
          rel={fileHref ? undefined : "noreferrer noopener"}
          onClick={(event) => {
            if (!href) return;
            if (isFileReference(href)) {
              event.preventDefault();
              tools.requestFileOpen(href);
              return;
            }
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
          {fileHref ? (
            <FileText className="chat-ref-chip-icon" aria-hidden />
          ) : (
            <ExternalLink className="chat-ref-chip-icon" aria-hidden />
          )}
          <span className="chat-ref-chip-label">{children}</span>
        </a>
      );
    },
  };
}

function AssistantMarkdownInner({ text }: { text: string }) {
  const tools = useTools();
  // Stable `components` map: only changes when any of the four tool callbacks
  // it captures changes identity (they're useCallback-stable in ToolsProvider).
  const componentsWithAppLinks = useMemo<Components>(
    () =>
      buildComponentsWithAppLinks({
        requestFileOpen: tools.requestFileOpen,
        setComputerOpen: tools.setComputerOpen,
        setComputerTab: tools.setComputerTab,
        setBrowserUrl: tools.setBrowserUrl,
      }),
    [tools.requestFileOpen, tools.setComputerOpen, tools.setComputerTab, tools.setBrowserUrl],
  );
  return (
    <div className="chat-markdown min-w-0 max-w-full overflow-x-hidden text-[10.4px] leading-[16px] tracking-normal [overflow-wrap:anywhere]">
      <MarkdownErrorBoundary
        fallback={
          <pre className="max-w-full whitespace-pre-wrap break-words text-[10.4px] leading-[17.6px] tracking-normal [font-family:var(--codex-chat-font-family)] [font-weight:var(--codex-chat-font-weight)] [overflow-wrap:anywhere]">
            {text}
          </pre>
        }
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={componentsWithAppLinks}>
          {text}
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
