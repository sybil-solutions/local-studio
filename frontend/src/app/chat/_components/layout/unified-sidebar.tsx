// CRITICAL
"use client";

import { type ReactNode } from "react";
import { PanelRightClose, Sparkles } from "lucide-react";

export type SidebarTab = "activity" | "context" | "artifacts" | "files";

interface UnifiedSidebarProps {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: SidebarTab;
  onSetActiveTab: (tab: SidebarTab) => void;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  activityContent: ReactNode;
  contextContent: ReactNode;
  artifactsContent: ReactNode;
  filesContent?: ReactNode;
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
  filesContent,
  hasArtifacts,
}: UnifiedSidebarProps) {
  // Fixed width for consistent layout - no resizing
  const width = 340;

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
          className="hidden md:flex shrink-0 flex-col h-full border-l border-white/[0.06] bg-[#0a0a0a]"
          style={{ width: `${width}px` }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
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
              {agentMode && (
                <>
                  <div className="w-px h-4 bg-white/[0.06] mx-1" />
                  <TabButton
                    active={activeTab === "files"}
                    onClick={() => onSetActiveTab("files")}
                    label="Files"
                    accent
                  />
                </>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <button
                onClick={onToggleAgentMode}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  agentMode
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                    : "bg-white/[0.03] text-[#666] border border-white/[0.06] hover:text-[#888]"
                }`}
                title={agentMode ? "Agent mode on" : "Enable agent mode"}
              >
                <Sparkles className="h-3 w-3" />
                Agent
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
          <div className="flex-1 overflow-hidden">{getActiveContent()}</div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-center">
            <span className="text-[10px] text-[#555]">
              {activeTab === "files"
                ? "Agent Files"
                : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
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
