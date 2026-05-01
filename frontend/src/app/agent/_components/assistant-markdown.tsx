"use client";

import React, { Children, isValidElement, useCallback, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
  return "";
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
      className="absolute right-1.5 top-1.5 rounded px-1 text-[10px] text-(--dim) hover:text-(--fg)"
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const components: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1 className="mb-1 mt-3 text-base font-semibold text-(--fg)" {...props} />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2 className="mb-1 mt-3 text-sm font-semibold text-(--fg)" {...props} />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3 className="mb-1 mt-3 text-xs font-semibold text-(--fg)" {...props} />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4 className="mb-1 mt-3 text-xs font-semibold text-(--fg)" {...props} />
  ),
  p: ({ node: _n, ...props }) => (
    <p className="my-2 text-sm leading-6 first:mt-0 last:mb-0" {...props} />
  ),
  ul: ({ node: _n, ...props }) => <ul className="my-2 list-disc pl-5" {...props} />,
  ol: ({ node: _n, ...props }) => <ol className="my-2 list-decimal pl-5" {...props} />,
  li: ({ node: _n, ...props }) => <li className="text-sm leading-6" {...props} />,
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
        className="rounded bg-(--surface) px-1 py-0.5 font-mono text-[12px] text-(--fg)"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _n, children, ...props }) => {
    const code = nodeToPlainText(
      Children.toArray(children).find(
        (child) => isValidElement(child) && (child as { type?: string }).type === "code",
      ) ?? children,
    );
    return (
      <pre
        className="relative my-2 overflow-x-auto rounded border border-(--border) bg-(--surface) p-2 text-[12px] leading-5"
        {...props}
      >
        {code ? <CodeBlockCopyButton code={code} /> : null}
        {children}
      </pre>
    );
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
  table: ({ node: _n, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse border border-(--border) text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => <thead className="bg-(--surface)" {...props} />,
  tr: ({ node: _n, ...props }) => <tr className="border-b border-(--border)" {...props} />,
  th: ({ node: _n, ...props }) => (
    <th
      className="border border-(--border) px-2 py-1 text-left font-medium text-(--fg)"
      {...props}
    />
  ),
  td: ({ node: _n, ...props }) => (
    <td className="border border-(--border) px-2 py-1 text-(--fg)" {...props} />
  ),
};

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-sm leading-6 text-(--fg)">
      <MarkdownErrorBoundary fallback={<pre className="whitespace-pre-wrap text-sm">{text}</pre>}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
}
