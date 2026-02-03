// CRITICAL
"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodePreviewProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
  maxHeight?: number;
}

export function CodePreview({
  code,
  language = "text",
  showLineNumbers = true,
  className,
  maxHeight,
}: CodePreviewProps) {
  const trimmed = String(code ?? "").replace(/\n$/, "");

  return (
    <div
      className={className}
      style={
        maxHeight
          ? {
              maxHeight: `${maxHeight}px`,
              overflow: "auto",
            }
          : undefined
      }
    >
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: "1rem",
          background: "transparent",
          fontSize: "0.875rem",
          lineHeight: "1.6",
        }}
        showLineNumbers={showLineNumbers}
        lineNumberStyle={{
          color: "var(--muted)",
          fontSize: "0.75rem",
          paddingRight: "1rem",
          minWidth: "2.5rem",
          textAlign: "right",
          userSelect: "none",
        }}
        wrapLongLines
      >
        {trimmed}
      </SyntaxHighlighter>
    </div>
  );
}
