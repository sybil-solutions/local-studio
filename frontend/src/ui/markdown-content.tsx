"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./utils";

const MARKDOWN_PLUGINS = [remarkGfm];

const markdownComponents: Components = {
  a: ({ children, href, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
};

export function MarkdownContent({
  markdown,
  className,
  components,
}: {
  markdown: string;
  className?: string;
  components?: Components;
}) {
  return (
    <div
      className={cx(
        "chat-markdown min-w-0 max-w-full overflow-x-auto text-[length:var(--fs-md)] leading-6 [overflow-wrap:anywhere]",
        className,
      )}
    >
      <ReactMarkdown
        skipHtml
        remarkPlugins={MARKDOWN_PLUGINS}
        components={{ ...markdownComponents, ...components }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
