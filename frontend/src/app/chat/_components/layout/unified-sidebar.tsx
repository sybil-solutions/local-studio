// CRITICAL
"use client";

import { type ReactNode, useCallback, useRef, useEffect, useState } from "react";
import { PanelRightClose, GripVertical } from "lucide-react";

export type SidebarTab = "activity" | "context" | "artifacts" | "files";

const MIN_WIDTH = 280;
const DEFAULT_MAX_WIDTH = 700;
const DEFAULT_WIDTH = 400;

interface UnifiedSidebarProps {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: SidebarTab;
  onSetActiveTab: (tab: SidebarTab) => void;
  activityContent: ReactNode;
  contextContent: ReactNode;
  artifactsContent: ReactNode;
  filesContent?: ReactNode;
  hasArtifacts: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
}

export function UnifiedSidebar({
  children,
  isOpen,
  onToggle,
  activeTab,
  onSetActiveTab,
  activityContent,
  contextContent,
  artifactsContent,
  filesContent,
  hasArtifacts,
  width: controlledWidth,
  onWidthChange,
}: UnifiedSidebarProps) {
  // Use controlled width if provided, otherwise use local state
  const [localWidth, setLocalWidth] = useState(DEFAULT_WIDTH);
  const width = controlledWidth ?? localWidth;
  const setWidth = useCallback(
    (newWidth: number) => {
      if (onWidthChange) {
        onWidthChange(newWidth);
      } else {
        setLocalWidth(newWidth);
      }
    },
    [onWidthChange],
  );

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeRef.current = { startX: e.clientX, startWidth: width };
    },
    [width],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const maxWidth = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.9));
      if (width > maxWidth) setWidth(maxWidth);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setWidth, width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      // Dragging left increases width, dragging right decreases
      const delta = resizeRef.current.startX - e.clientX;
      const maxWidth =
        typeof window !== "undefined"
          ? Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.9))
          : DEFAULT_MAX_WIDTH;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, resizeRef.current.startWidth + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setWidth]);

  const getActiveContent = () => {
    switch (activeTab) {
      case "activity":
        return activityContent;
      case "context":
        return contextContent;
      case "artifacts":
        return artifactsContent;
      case "files":
        return filesContent ?? null;
      default:
        return activityContent;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>

      {isOpen && (
        <div
          className="hidden md:flex shrink-0 flex-col h-full border-l border-white/[0.06] bg-[#050505] relative shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          style={{ width: `${width}px` }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_10%_-10%,rgba(90,255,214,0.08),transparent_55%),radial-gradient(140%_80%_at_90%_-20%,rgba(126,141,255,0.10),transparent_60%),linear-gradient(180deg,rgba(10,10,10,0.9),rgba(4,4,4,0.9))]" />
          <div className="absolute inset-0 border-l border-white/[0.02]" />
          {/* Resize handle */}
          <div
            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 group flex items-center justify-center
              ${isResizing ? "bg-violet-500/30" : "hover:bg-violet-500/20"}`}
            onMouseDown={handleResizeStart}
          >
            <div
              className={`absolute left-0 w-4 h-12 flex items-center justify-center rounded-r transition-opacity
                ${isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            >
              <GripVertical className="h-4 w-4 text-violet-400/50" />
            </div>
          </div>

          {/* Header */}
          <div className="relative flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
              <TabButton
                active={activeTab === "activity"}
                onClick={() => onSetActiveTab("activity")}
                label="Activity"
              />
              <TabButton
                active={activeTab === "context"}
                onClick={() => onSetActiveTab("context")}
                label="Context"
              />
              {hasArtifacts && (
                <TabButton
                  active={activeTab === "artifacts"}
                  onClick={() => onSetActiveTab("artifacts")}
                  label="Preview"
                />
              )}
              <div className="w-px h-4 bg-white/[0.06] mx-1" />
              <TabButton
                active={activeTab === "files"}
                onClick={() => onSetActiveTab("files")}
                label="Files"
                accent
              />
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <button
                onClick={onToggle}
                className="p-1.5 rounded hover:bg-white/[0.06] text-[#555]"
                title="Close sidebar"
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="relative flex-1 overflow-hidden">{getActiveContent()}</div>

          {/* Footer */}
          <div className="relative px-3 py-2 border-t border-white/[0.06] flex items-center justify-center">
            <span className="text-[10px] text-[#555]">
              {activeTab === "files"
                ? "Agent Files"
                : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </span>
          </div>
        </div>
      )}

      {/* Global resize cursor when dragging */}
      {isResizing && (
        <style jsx global>{`
          body {
            cursor: col-resize !important;
            user-select: none !important;
          }
        `}</style>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
        active
          ? accent
            ? "bg-violet-500/15 text-violet-300"
            : "bg-white/[0.08] text-foreground"
          : accent
            ? "text-violet-400/50 hover:text-violet-300/70 hover:bg-violet-500/5"
            : "text-[#666] hover:text-[#888] hover:bg-white/[0.03]"
      }`}
    >
      {label}
    </button>
  );
}
