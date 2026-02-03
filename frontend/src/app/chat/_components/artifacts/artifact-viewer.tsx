// CRITICAL
"use client";

import {
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Code,
  Eye,
  EyeOff,
  FileCode,
  Palette,
  Maximize2,
  X,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Move,
  RotateCcw,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { Artifact } from "@/lib/types";
import { useAppStore } from "@/store";
import {
  buildSvgDocument,
  buildReactDocument,
  buildJsDocument,
  buildHtmlDocument,
  buildTextDocument,
} from "./artifact-templates";

interface ArtifactViewerProps {
  artifact: Artifact;
  isActive?: boolean;
}

interface ArtifactViewerContentProps {
  artifact: Artifact;
  icon: ReactNode;
  isRunning: boolean;
  showCode: boolean;
  copied: boolean;
  error: string | null;
  inModal?: boolean;
  onClose?: () => void;
  onRun: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onToggleCode: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onOpenExternal: () => void;
  onEnterFullscreen?: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  scale: number;
  isDragging: boolean;
  position: { x: number; y: number };
  onMouseDown?: (e: ReactMouseEvent) => void;
  onWheel?: (e: ReactWheelEvent) => void;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

function ArtifactViewerContent({
  artifact,
  icon,
  isRunning,
  showCode,
  copied,
  error,
  inModal = false,
  onClose,
  onRun,
  onStop,
  onRefresh,
  onToggleCode,
  onCopy,
  onDownload,
  onOpenExternal,
  onEnterFullscreen,
  zoomIn,
  zoomOut,
  resetView,
  scale,
  isDragging,
  position,
  onMouseDown,
  onWheel,
  iframeRef,
  containerRef,
}: ArtifactViewerContentProps) {
  return (
    <div className={`flex flex-col ${inModal ? "h-full" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2 bg-(--accent) border-b border-(--border) shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-medium truncate">
            {artifact.title || artifact.type.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {isRunning ? (
            <button
              onClick={onStop}
              className="p-1.5 rounded hover:bg-background text-(--error)"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={onRun}
              className="p-1.5 rounded hover:bg-background text-(--success)"
              title="Run"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onRefresh}
            className="p-1.5 rounded hover:bg-background"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button
            onClick={onToggleCode}
            className="p-1.5 rounded hover:bg-background"
            title={showCode ? "Hide code" : "Show code"}
          >
            {showCode ? (
              <EyeOff className="h-3.5 w-3.5 text-[#9a9590]" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-[#9a9590]" />
            )}
          </button>
          <button onClick={onCopy} className="p-1.5 rounded hover:bg-background" title="Copy">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-(--success)" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-[#9a9590]" />
            )}
          </button>
          <button
            onClick={onDownload}
            className="p-1.5 rounded hover:bg-background"
            title="Download"
          >
            <Download className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button
            onClick={onOpenExternal}
            className="p-1.5 rounded hover:bg-background"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          {!inModal && onEnterFullscreen && (
            <button
              onClick={onEnterFullscreen}
              className="p-1.5 rounded hover:bg-background"
              title="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          {inModal && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-background"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {inModal && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-background border-b border-(--border) shrink-0">
          <button onClick={zoomOut} className="p-1 rounded hover:bg-(--accent)" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <span className="text-xs text-[#9a9590] tabular-nums w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} className="p-1 rounded hover:bg-(--accent)" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <div className="w-px h-4 bg-(--border) mx-1" />
          <button
            onClick={resetView}
            className="p-1 rounded hover:bg-(--accent)"
            title="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button
            className={`p-1 rounded ${isDragging ? "bg-(--accent)" : "hover:bg-(--accent)"}`}
            title="Pan (drag)"
          >
            <Move className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
        </div>
      )}

      {showCode && (
        <pre className="p-3 text-xs bg-[#1e1d1c] overflow-auto border-b border-(--border) shrink-0 max-h-40">
          <code className="text-[#e8e4dd]">{artifact.code}</code>
        </pre>
      )}

      {error && (
        <div className="px-3 py-2 bg-(--error)/10 text-(--error) text-xs border-b border-(--border) shrink-0">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative overflow-hidden bg-[#0f0f10] ${
          inModal ? "flex-1 min-h-0" : "h-100"
        }`}
        style={inModal && scale !== 1 ? { cursor: isDragging ? "grabbing" : "grab" } : undefined}
        onMouseDown={inModal ? onMouseDown : undefined}
        onWheel={inModal ? onWheel : undefined}
      >
        <div
          className="w-full h-full"
          style={
            inModal
              ? {
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: "center center",
                  transition: isDragging ? "none" : "transform 0.15s ease",
                }
              : undefined
          }
        >
          <iframe
            ref={iframeRef}
            className="block w-full h-full border-0"
            sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
            title={artifact.title || "Artifact Preview"}
          />
        </div>
      </div>
    </div>
  );
}

export function ArtifactViewer({ artifact, isActive = true }: ArtifactViewerProps) {
  const viewerState = useAppStore(
    (state) =>
      state.artifactViewerState[artifact.id] ?? {
        isFullscreen: false,
        showCode: false,
        copied: false,
        scale: 1,
        position: { x: 0, y: 0 },
        isDragging: false,
        isRunning: true,
        error: null,
      },
  );
  const updateArtifactViewerState = useAppStore((state) => state.updateArtifactViewerState);
  const { isFullscreen, showCode, copied, scale, position, isDragging, isRunning, error } =
    viewerState;
  const updateState = (partial: Partial<typeof viewerState>) => {
    updateArtifactViewerState(artifact.id, (prev) => ({ ...prev, ...partial }));
  };
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const getSrcDoc = useCallback(() => {
    switch (artifact.type) {
      case "svg": {
        const svgMarkup = artifact.code.includes("<svg")
          ? artifact.code
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;
        return buildSvgDocument(svgMarkup, scale);
      }
      case "react":
        return buildReactDocument(artifact.code);
      case "javascript":
        return buildJsDocument(artifact.code);
      case "html":
        return buildHtmlDocument(artifact.code);
      default:
        return buildTextDocument(artifact.code);
    }
  }, [artifact, scale]);

  const runArtifact = useCallback(() => {
    updateState({ isRunning: true, error: null });
    if (iframeRef.current) {
      iframeRef.current.srcdoc = getSrcDoc();
    }
  }, [getSrcDoc, updateState]);

  const stopArtifact = useCallback(() => {
    updateState({ isRunning: false });
    if (iframeRef.current) {
      iframeRef.current.srcdoc = "";
    }
  }, [updateState]);

  useEffect(() => {
    if (!isActive) return;
    const timeoutId = window.setTimeout(() => {
      runArtifact();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isActive, artifact.id, runArtifact]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "error") {
        updateState({ error: event.data.message });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [updateState]);

  const zoomIn = () => {
    updateState({ scale: Math.min(scale + 0.25, 3) });
  };
  const zoomOut = () => {
    updateState({ scale: Math.max(scale - 0.25, 0.25) });
  };
  const resetView = () => {
    updateState({ scale: 1, position: { x: 0, y: 0 } });
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    updateState({ isDragging: true });
    dragStartRef.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
  };

  const handleMouseMove = useCallback(
    (e: globalThis.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      updateState({
        position: { x: dragStartRef.current.posX + dx, y: dragStartRef.current.posY + dy },
      });
    },
    [isDragging, updateState],
  );

  const handleMouseUp = useCallback(() => {
    updateState({ isDragging: false });
  }, [updateState]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      updateState({ scale: Math.max(0.25, Math.min(3, scale + delta)) });
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.code);
    updateState({ copied: true });
    setTimeout(() => updateState({ copied: false }), 2000);
  };

  const handleDownload = () => {
    const ext =
      artifact.type === "html"
        ? ".html"
        : artifact.type === "react" || artifact.type === "javascript"
          ? ".jsx"
          : artifact.type === "svg"
            ? ".svg"
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

  const handleOpenExternal = () => {
    const blob = new Blob([getSrcDoc()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const icon =
    artifact.type === "svg" ? (
      <Palette className="h-3.5 w-3.5" />
    ) : artifact.type === "html" ? (
      <FileCode className="h-3.5 w-3.5" />
    ) : (
      <Code className="h-3.5 w-3.5" />
    );

  const viewerContentProps = {
    artifact,
    icon,
    isRunning,
    showCode,
    copied,
    error,
    onRun: runArtifact,
    onStop: stopArtifact,
    onRefresh: runArtifact,
    onToggleCode: () => updateState({ showCode: !showCode }),
    onCopy: handleCopy,
    onDownload: handleDownload,
    onOpenExternal: handleOpenExternal,
    onEnterFullscreen: () => updateState({ isFullscreen: true }),
    zoomIn,
    zoomOut,
    resetView,
    scale,
    isDragging,
    position,
    onMouseDown: handleMouseDown,
    onWheel: handleWheel,
    iframeRef,
    containerRef,
  };

  return (
    <>
      <div className="rounded-lg border border-(--border) overflow-hidden bg-(--card)">
        <ArtifactViewerContent {...viewerContentProps} />
      </div>

      {isFullscreen && (
        <>
          <div
            className="fixed inset-0 z-100 bg-black/80"
            onClick={() => updateState({ isFullscreen: false })}
          />
          <div className="fixed inset-3 md:inset-6 z-101 bg-(--card) rounded-xl border border-(--border) overflow-hidden flex flex-col">
            <ArtifactViewerContent
              {...viewerContentProps}
              inModal
              onClose={() => updateState({ isFullscreen: false })}
            />
          </div>
        </>
      )}
    </>
  );
}
