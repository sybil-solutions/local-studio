// CRITICAL
"use client";

import { useMemo } from "react";
import {
  Code,
  Eye,
  EyeOff,
  FileCode,
  Palette,
  Maximize2,
  Minimize2,
  Download,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { CodeSandbox } from "../code/code-sandbox";
import type { Artifact } from "@/lib/types";
import { useAppStore } from "@/store";

// SVG template - wraps SVG in proper HTML document for iframe rendering
const SVG_TEMPLATE = (svgCode: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f10;
      overflow: auto;
      color: #f6f3ee;
    }
    .frame {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 12px;
    }
    svg {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
    }
  </style>
</head>
  <body>
    <div class="frame">
      ${svgCode}
    </div>
  </body>
</html>
`;

interface ArtifactRendererProps {
  artifact: Artifact;
}

export function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  const showPreview = true;
  const artifactState = useAppStore(
    (state) =>
      state.artifactRendererState[artifact.id] ?? {
        isFullscreen: false,
        showCode: false,
        copied: false,
      },
  );
  const updateArtifactRendererState = useAppStore((state) => state.updateArtifactRendererState);
  const { isFullscreen, showCode, copied } = artifactState;
  const updateState = (partial: Partial<typeof artifactState>) => {
    updateArtifactRendererState(artifact.id, (prev) => ({ ...prev, ...partial }));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      updateState({ copied: true });
      setTimeout(() => updateState({ copied: false }), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleDownload = () => {
    const ext =
      artifact.type === "html"
        ? ".html"
        : artifact.type === "react" || artifact.type === "javascript"
          ? ".jsx"
          : artifact.type === "svg"
            ? ".svg"
            : artifact.type === "python"
              ? ".py"
              : ".txt";
    const filename =
      (artifact.title || `artifact-${artifact.id}`).replace(/[^a-z0-9]/gi, "-").toLowerCase() + ext;
    const blob = new Blob([artifact.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: artifact.title || "Code Artifact",
          text: artifact.code,
        });
      } catch {
        // User cancelled or share failed
        handleCopy(); // Fallback to copy
      }
    } else {
      handleCopy(); // Fallback to copy
    }
  };

  const language = useMemo(() => {
    switch (artifact.type) {
      case "html":
        return "html" as const;
      case "react":
        return "react" as const;
      case "python":
        return "javascript" as const; // Python will need backend execution
      case "javascript":
        return "javascript" as const;
      default:
        return "html" as const;
    }
  }, [artifact.type]);

  const icon = useMemo(() => {
    switch (artifact.type) {
      case "html":
        return <FileCode className="h-3.5 w-3.5" />;
      case "react":
        return <Code className="h-3.5 w-3.5" />;
      case "svg":
        return <Palette className="h-3.5 w-3.5" />;
      default:
        return <Code className="h-3.5 w-3.5" />;
    }
  }, [artifact.type]);

  // Toolbar buttons for SVG artifacts
  const renderSvgToolbarButtons = (inFooter = false) => (
    <div className={`flex items-center gap-0.5 ${inFooter ? "justify-center" : ""}`}>
      <button
        onClick={handleCopy}
        className="p-2 md:p-1.5 rounded hover:bg-(--background) transition-colors"
        title="Copy code"
      >
        {copied ? (
          <Check className="h-5 w-5 md:h-3.5 md:w-3.5 text-(--success)" />
        ) : (
          <Copy className="h-5 w-5 md:h-3.5 md:w-3.5 text-[#9a9590]" />
        )}
      </button>
      <button
        onClick={handleDownload}
        className="p-2 md:p-1.5 rounded hover:bg-(--background) transition-colors"
        title="Download"
      >
        <Download className="h-5 w-5 md:h-3.5 md:w-3.5 text-[#9a9590]" />
      </button>
      <button
        onClick={handleShare}
        className="p-2 md:p-1.5 rounded hover:bg-(--background) transition-colors"
        title="Share"
      >
        <Share2 className="h-5 w-5 md:h-3.5 md:w-3.5 text-[#9a9590]" />
      </button>
      <button
        onClick={() => updateState({ showCode: !showCode })}
        className={`${inFooter ? "block" : "hidden md:block"} p-2 md:p-1.5 rounded hover:bg-(--background) transition-colors`}
        title={showCode ? "Hide code" : "Show code"}
      >
        {showCode ? (
          <EyeOff className="h-5 w-5 md:h-3.5 md:w-3.5 text-[#9a9590]" />
        ) : (
          <Eye className="h-5 w-5 md:h-3.5 md:w-3.5 text-[#9a9590]" />
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          updateState({ isFullscreen: !isFullscreen });
        }}
        className="p-2 md:p-1.5 rounded hover:bg-(--background) transition-colors"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? (
          <Minimize2 className="h-5 w-5 md:h-3.5 md:w-3.5" />
        ) : (
          <Maximize2 className="h-5 w-5 md:h-3.5 md:w-3.5" />
        )}
      </button>
    </div>
  );

  // Handle SVG via iframe (like ChatGPT-Next-Web approach for proper mobile rendering)
  if (artifact.type === "svg") {
    const svgMarkup = artifact.code.includes("<svg")
      ? artifact.code
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;

    const svgHtml = SVG_TEMPLATE(svgMarkup);

    return (
      <>
        {/* Fullscreen backdrop */}
        {isFullscreen && (
          <div
            className="fixed inset-0 z-[100] bg-black/80"
            onClick={() => updateState({ isFullscreen: false })}
          />
        )}
        <div
          className={`my-2 rounded-lg border border-(--border) overflow-hidden artifact-container ${
            isFullscreen
              ? "fixed inset-2 md:inset-4 z-[101] m-0 rounded-lg flex flex-col bg-(--background)"
              : "max-w-full"
          }`}
          style={
            isFullscreen
              ? {
                  paddingTop: "env(safe-area-inset-top, 0)",
                  paddingBottom: "env(safe-area-inset-bottom, 0)",
                }
              : undefined
          }
        >
          {/* Header - minimal in fullscreen */}
          <div className="flex items-center justify-between px-2 md:px-3 py-1.5 md:py-2 bg-(--card) border-b border-(--border) flex-shrink-0">
            <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
              {icon}
              <span className="text-xs font-medium truncate">{artifact.title || "SVG"}</span>
            </div>

            {/* Show controls in header only when NOT fullscreen */}
            {!isFullscreen && renderSvgToolbarButtons()}

            {/* In fullscreen, just show minimize button in header */}
            {isFullscreen && (
              <button
                onClick={() => updateState({ isFullscreen: false })}
                className="p-2 rounded hover:bg-(--background) transition-colors"
                title="Exit fullscreen"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            )}
          </div>
          {showCode && (
            <pre className="p-2 md:p-3 text-xs bg-(--background) overflow-x-auto border-b border-(--border) flex-shrink-0 max-h-32 md:max-h-48">
              <code>{artifact.code}</code>
            </pre>
          )}
          {/* SVG rendered in iframe for proper mobile support */}
          <div className={`overflow-hidden ${isFullscreen ? "flex-1" : ""}`}>
            <iframe
              srcDoc={svgHtml}
              className="w-full border-0 bg-[#0f0f10]"
              style={{ height: isFullscreen ? "100%" : "200px", minHeight: "120px" }}
              sandbox="allow-scripts"
              title={artifact.title || "SVG Preview"}
            />
          </div>

          {/* Footer controls - only in fullscreen mode */}
          {isFullscreen && (
            <div className="flex-shrink-0 px-3 py-3 bg-(--accent) border-t border-(--border)">
              {renderSvgToolbarButtons(true)}
            </div>
          )}
        </div>
      </>
    );
  }

  // Handle Mermaid (delegate to parent's mermaid renderer)
  if (artifact.type === "mermaid") {
    return (
      <div className="my-2">
        <pre className="mermaid">{artifact.code}</pre>
      </div>
    );
  }

  // Handle Python (needs backend execution)
  if (artifact.type === "python") {
    return (
      <div className="my-2 rounded-lg border border-(--border) overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-(--accent) border-b border-(--border)">
          <div className="flex items-center gap-2">
            <Code className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{artifact.title || "Python"}</span>
            <span className="text-xs text-[#9a9590] px-1.5 py-0.5 bg-(--background) rounded">
              python
            </span>
          </div>
        </div>
        <pre className="p-3 text-xs bg-(--background) overflow-x-auto">
          <code>{artifact.code}</code>
        </pre>
        {artifact.output && (
          <div className="p-3 border-t border-(--border) bg-(--card)">
            <p className="text-xs text-[#9a9590] mb-1">Output:</p>
            <pre className="text-xs whitespace-pre-wrap">{artifact.output}</pre>
          </div>
        )}
        {artifact.error && (
          <div className="p-3 border-t border-(--border) bg-(--error)/10">
            <p className="text-xs text-(--error)">{artifact.error}</p>
          </div>
        )}
      </div>
    );
  }

  // Handle HTML, React, JavaScript with CodeSandbox
  return (
    <div className="my-2">
      <CodeSandbox
        code={artifact.code}
        language={language}
        title={artifact.title}
        autoRun={showPreview}
      />
    </div>
  );
}

// Utility to extract artifacts from message content
export function extractArtifacts(
  content: string,
  options?: { includeImplicit?: boolean },
): { text: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  let text = content;

  // Pattern 1: <artifact type="html" title="...">...</artifact>
  const artifactTagRegex =
    /<artifact\s+type="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;
  let match;

  while ((match = artifactTagRegex.exec(content)) !== null) {
    const type = match[1] as Artifact["type"];
    const title = match[2] || "";
    const code = match[3].trim();

    artifacts.push({
      id: `artifact-${artifacts.length}-${Date.now()}`,
      type,
      title,
      code,
    });

    // Remove the artifact from text
    text = text.replace(match[0], `[Artifact: ${title || type}]`);
  }

  // Pattern 2: ```artifact-html ... ``` or ```artifact-react ... ```
  const artifactCodeBlockRegex =
    /```artifact-(html|react|javascript|python|svg|mermaid)\s*\n([\s\S]*?)```/g;

  while ((match = artifactCodeBlockRegex.exec(content)) !== null) {
    const type = match[1] as Artifact["type"];
    const code = match[2].trim();

    artifacts.push({
      id: `artifact-${artifacts.length}-${Date.now()}`,
      type,
      title: "",
      code,
    });

    text = text.replace(match[0], `[Artifact: ${type}]`);
  }

  // Pattern 3: Regular HTML code blocks (```html) when artifacts mode is enabled
  if (options?.includeImplicit) {
    const implicitCodeBlockRegex = /```(html|svg)\s*\n([\s\S]*?)```/g;
    while ((match = implicitCodeBlockRegex.exec(content)) !== null) {
      const type = match[1] as Artifact["type"];
      const code = match[2].trim();
      artifacts.push({
        id: `artifact-${artifacts.length}-${Date.now()}`,
        type,
        title: "",
        code,
      });
      text = text.replace(match[0], `[Artifact: ${type}]`);
    }
  }

  return { text, artifacts };
}

// Check if a code block should be treated as an artifact
export function isArtifactCodeBlock(language: string): boolean {
  const artifactLanguages = [
    "artifact-html",
    "artifact-react",
    "artifact-python",
    "artifact-svg",
    "artifact-mermaid",
  ];
  return artifactLanguages.includes(language);
}

// Get artifact type from code block language
export function getArtifactType(language: string): Artifact["type"] | null {
  const mapping: Record<string, Artifact["type"]> = {
    "artifact-html": "html",
    "artifact-react": "react",
    "artifact-javascript": "javascript",
    "artifact-python": "python",
    "artifact-svg": "svg",
    "artifact-mermaid": "mermaid",
    html: "html",
    react: "react",
    jsx: "react",
    tsx: "react",
    svg: "svg",
    javascript: "javascript",
    js: "javascript",
  };
  return mapping[language] || null;
}
