// CRITICAL
"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";

type SidebarTab = "activity" | "context" | "artifacts" | "agent-files" | "agent-plans" | "agent-settings";

interface UnifiedSidebarProps {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: SidebarTab;
  onSetActiveTab: (tab: SidebarTab) => void;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  // Content props
  activityContent: ReactNode;
  contextContent: ReactNode;
  artifactsContent: ReactNode;
  agentFilesContent: ReactNode;
  agentPlansContent: ReactNode;
  agentSettingsContent: ReactNode;
  // Config
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  hasArtifacts: boolean;
}

export function UnifiedSidebar({
  children,
  isOpen,
  onToggle,
  activeTab,
  onSetActiveTab,
  agentMode,
  onToggleAgentMode,
  activityContent,
  contextContent,
  artifactsContent,
  agentFilesContent,
  agentPlansContent,
  agentSettingsContent,
  defaultWidth = 380,
  minWidth = 280,
  maxWidth = 600,
  hasArtifacts,
}: UnifiedSidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const delta = startXRef.current - e.clientX;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
    setWidth(newWidth);
  }, [isResizing, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const getActiveContent = () => {
    switch (activeTab) {
      case "activity": return activityContent;
      case "context": return contextContent;
      case "artifacts": return artifactsContent;
      case "agent-files": return agentFilesContent;
      case "agent-plans": return agentPlansContent;
      case "agent-settings": return agentSettingsContent;
      default: return activityContent;
    }
  };

  const getTabLabel = (tab: SidebarTab) => {
    switch (tab) {
      case "activity": return "Activity";
      case "context": return "Context";
      case "artifacts": return "Preview";
      case "agent-files": return "Files";
      case "agent-plans": return "Plans";
      case "agent-settings": return "Settings";
      default: return tab;
    }
  };

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>

      {/* Resizable sidebar */}
      {isOpen && (
        <div
          className="hidden md:flex flex-shrink-0 flex-col h-full border-l border-white/[0.06] bg-[#0a0a0a] relative"
          style={{ width: `${width}px` }}
        >
          {/* Resize handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/10 transition-colors z-10"
            onMouseDown={handleMouseDown}
          />

          {/* Header with tabs */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
              {/* Standard tabs */}
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
              
              {/* Agent mode indicator */}
              {agentMode && (
                <>
                  <div className="w-px h-4 bg-white/[0.08] mx-1" />
                  <TabButton
                    active={activeTab === "agent-files"}
                    onClick={() => onSetActiveTab("agent-files")}
                    label="Files"
                    isAgent
                  />
                  <TabButton
                    active={activeTab === "agent-plans"}
                    onClick={() => onSetActiveTab("agent-plans")}
                    label="Plans"
                    isAgent
                  />
                  <TabButton
                    active={activeTab === "agent-settings"}
                    onClick={() => onSetActiveTab("agent-settings")}
                    label="Settings"
                    isAgent
                  />
                </>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              {/* Agent mode toggle */}
              <button
                onClick={onToggleAgentMode}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  agentMode
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                    : "bg-white/[0.03] text-[#666] border border-white/[0.06] hover:text-[#888]"
                }`}
              >
                {agentMode ? "Agent" : "Agent"}
              </button>
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
          <div className="flex-1 overflow-hidden">
            {getActiveContent()}
          </div>

          {/* Current tab indicator */}
          <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-[10px] text-[#555]">
              {getTabLabel(activeTab)}
            </span>
            <span className="text-[10px] text-[#444]">
              {width}px
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  isAgent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  isAgent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
        active
          ? isAgent
            ? "bg-violet-500/20 text-violet-300"
            : "bg-white/[0.08] text-foreground"
          : "text-[#666] hover:text-[#888] hover:bg-white/[0.03]"
      }`}
    >
      {label}
    </button>
  );
}
