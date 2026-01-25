// CRITICAL
"use client";

import { useMemo, useId } from "react";
import { Copy, Check, Play, Code2, Maximize2, Minimize2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CodeSandbox } from "./code-sandbox";
import { ArtifactRenderer } from "../artifacts/artifact-renderer";
import { useMessageParsing } from "@/lib/services/message-parsing";
import { useAppStore } from "@/store";

// Map common code languages to artifact types
const IMPLICIT_ARTIFACT_MAP: Record<string, string> = {
  jsx: "react",
  tsx: "react",
  react: "react",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  svg: "svg",
};

interface EnhancedCodeBlockProps {
  children: string;
  className?: string;
  artifactsEnabled?: boolean;
  isStreaming?: boolean;
  language?: string;
}

export function EnhancedCodeBlock({
  children,
  className,
  artifactsEnabled,
  language,
  isStreaming,
}: EnhancedCodeBlockProps) {
  const blockId = useId();
  const blockState = useAppStore(
    (state) =>
      state.codeBlockState[blockId] ?? {
        copied: false,
        isExpanded: false,
        showPreview: false,
      },
  );
  const updateCodeBlockState = useAppStore((state) => state.updateCodeBlockState);
  const { copied, isExpanded, showPreview } = blockState;
  const updateState = (partial: Partial<typeof blockState>) => {
    updateCodeBlockState(blockId, (prev) => ({ ...prev, ...partial }));
  };
  const { getArtifactType } = useMessageParsing();
  const lang = language || className?.replace("language-", "") || "text";
  const code = String(children).replace(/\n$/, "");

  // Allow previews for explicit artifact fences OR common code languages when artifacts enabled
  const isExplicitArtifact = lang.startsWith("artifact-");

  // Get artifact type - either from explicit artifact- prefix or implicit mapping
  const artifactType = useMemo(() => {
    if (isStreaming) {
      return null;
    }
    if (isExplicitArtifact) {
      return getArtifactType(lang);
    }
    return artifactsEnabled ? IMPLICIT_ARTIFACT_MAP[lang.toLowerCase()] : null;
  }, [isStreaming, isExplicitArtifact, getArtifactType, lang, artifactsEnabled]);

  const canPreview =
    artifactsEnabled &&
    artifactType &&
    ["html", "react", "javascript", "svg"].includes(artifactType);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    updateState({ copied: true });
    setTimeout(() => updateState({ copied: false }), 2000);
  };

  if (isStreaming) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-(--border) bg-(--card)/90 shadow-sm">
        <div className="flex items-center justify-between bg-(--card-hover)/80 backdrop-blur-sm px-4 py-2.5 border-b border-(--border)">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
            </div>
            <span className="text-xs font-mono font-medium text-[#b0a8a0] bg-(--background) px-2 py-0.5 rounded">
              {lang || "code"}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={copyCode}
              className="p-1.5 rounded-lg hover:bg-(--card-hover) transition-all duration-200 text-[#9a9590] hover:text-(--foreground)"
              title="Copy code"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-(--success)" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        <pre className="px-4 py-3 text-sm leading-relaxed font-mono text-[#e8e4dd] bg-transparent overflow-x-auto whitespace-pre">
          {code}
        </pre>
      </div>
    );
  }

  // If showing preview, render CodeSandbox
  if (showPreview && canPreview && artifactType) {
    if (artifactType === "svg") {
      return (
        <div className="my-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <ArtifactRenderer
            artifact={{ id: "inline-svg", type: "svg", title: `${lang} Preview`, code }}
          />
          <button
            onClick={() => updateState({ showPreview: false })}
            className="mt-2 text-xs text-[#9a9590] hover:text-(--foreground) transition-colors flex items-center gap-1"
          >
            <Code2 className="h-3 w-3" />
            Show code
          </button>
        </div>
      );
    }

    return (
      <div className="my-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <CodeSandbox
          code={code}
          language={artifactType as "html" | "react" | "javascript"}
          title={`${lang} Preview`}
          autoRun={true}
        />
        <button
          onClick={() => updateState({ showPreview: false })}
          className="mt-2 text-xs text-[#9a9590] hover:text-(--foreground) transition-colors flex items-center gap-1"
        >
          <Code2 className="h-3 w-3" />
          Show code
        </button>
      </div>
    );
  }

  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > 20;
  const shouldCollapse = isLongCode && !isExpanded;

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-(--border) bg-(--card)/90 shadow-sm transition-all duration-200 hover:shadow-md group">
      {/* Header */}
      <div className="flex items-center justify-between bg-(--card-hover)/80 backdrop-blur-sm px-4 py-2.5 border-b border-(--border)">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
          </div>
          <span className="text-xs font-mono font-medium text-[#b0a8a0] bg-(--background) px-2 py-0.5 rounded">
            {lang || "code"}
          </span>
          {isLongCode && <span className="text-xs text-[#9a9590]">{lineCount} lines</span>}
        </div>

        <div className="flex items-center gap-1">
          {canPreview && (
            <button
              onClick={() => updateState({ showPreview: true })}
              className="p-1.5 rounded-lg hover:bg-(--card-hover) transition-all duration-200 flex items-center gap-1.5 text-xs font-medium text-[#9fc68a] hover:text-[#b7e4a0]"
              title="Run preview"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          )}

          {isLongCode && (
            <button
              onClick={() => updateState({ isExpanded: !isExpanded })}
              className="p-1.5 rounded-lg hover:bg-(--card-hover) transition-all duration-200 text-[#9a9590] hover:text-(--foreground)"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          <button
            onClick={copyCode}
            className="p-1.5 rounded-lg hover:bg-(--card-hover) transition-all duration-200 text-[#9a9590] hover:text-(--foreground)"
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-(--success)" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className={shouldCollapse ? "max-h-[300px] overflow-hidden relative" : ""}>
        <SyntaxHighlighter
          language={lang}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "0.875rem",
            lineHeight: "1.6",
          }}
          showLineNumbers
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
          {code}
        </SyntaxHighlighter>

        {shouldCollapse && (
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-(--card) to-transparent flex items-end justify-center pb-3">
            <button
              onClick={() => updateState({ isExpanded: true })}
              className="text-xs text-[#b0a8a0] hover:text-(--foreground) transition-colors flex items-center gap-1"
            >
              Expand full code
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
