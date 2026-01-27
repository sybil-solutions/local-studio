// CRITICAL
"use client";

import { useState } from "react";
import { Folder, Target, Settings, Bot, Sparkles, Terminal, ChevronRight } from "lucide-react";
import { AgentFileExplorer, type FileNode } from "./agent-file-explorer";
import { AgentPlanManager, type Plan } from "./agent-plan-manager";
import { cn } from "@/lib/utils";

type WorkspaceTab = "files" | "plans" | "settings" | "terminal";

interface AgentWorkspaceProps {
  files: FileNode[];
  plans: Plan[];
  activePlanId?: string;
  selectedFilePath?: string;
  isAgentMode: boolean;
  onToggleAgentMode: () => void;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRefreshFiles: () => void;
  onCreatePlan: (plan: Omit<Plan, "id" | "createdAt" | "updatedAt" | "progress">) => void;
  onUpdatePlan: (id: string, updates: Partial<Plan>) => void;
  onDeletePlan: (id: string) => void;
  onSelectPlan: (id: string) => void;
  onUpdateStep: (planId: string, stepId: string, updates: Partial<Plan["steps"][0]>) => void;
  workingDirectory?: string;
  onChangeWorkingDirectory?: (path: string) => void;
}

export function AgentWorkspace({
  files,
  plans,
  activePlanId,
  selectedFilePath,
  isAgentMode,
  onToggleAgentMode,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRefreshFiles,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  onSelectPlan,
  onUpdateStep,
  workingDirectory = "~/agent-workspace",
}: AgentWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("files");

  if (!isAgentMode) {
    return (
      <div className="flex flex-col h-full bg-[#0a0a0a] border-l border-white/[0.06]">
        {/* Agent Mode Activation Panel */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center mb-4 border border-violet-500/20">
            <Bot className="h-8 w-8 text-violet-400" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-2">Agent Mode</h3>
          <p className="text-[11px] text-[#666] mb-6 max-w-[200px] leading-relaxed">
            Enable agent mode to give the AI access to your filesystem, 
            create projects, and execute code.
          </p>
          <button
            onClick={onToggleAgentMode}
            className="flex items-center gap-2 px-4 py-2 bg-violet-500/20 text-violet-300 rounded-lg text-xs font-medium hover:bg-violet-500/30 transition-colors border border-violet-500/30"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Enable Agent Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] border-l border-white/[0.06]">
      {/* Header with Agent Status */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
              <Sparkles className="h-3 w-3 text-violet-400" />
            </div>
            <span className="text-xs font-medium text-foreground">Agent</span>
          </div>
          <button
            onClick={onToggleAgentMode}
            className="text-[10px] text-[#666] hover:text-[#888] transition-colors"
          >
            Disable
          </button>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-[#555]">
          <Terminal className="h-3 w-3" />
          <span className="truncate">{workingDirectory}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06]">
        <TabButton
          active={activeTab === "files"}
          onClick={() => setActiveTab("files")}
          icon={Folder}
          label="Files"
        />
        <TabButton
          active={activeTab === "plans"}
          onClick={() => setActiveTab("plans")}
          icon={Target}
          label="Plans"
          badge={plans.length}
        />
        <TabButton
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
          icon={Settings}
          label="Settings"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "files" && (
          <AgentFileExplorer
            files={files}
            selectedPath={selectedFilePath}
            onSelect={onSelectFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onDelete={onDeleteFile}
            onRefresh={onRefreshFiles}
          />
        )}
        {activeTab === "plans" && (
          <AgentPlanManager
            plans={plans}
            activePlanId={activePlanId}
            onCreatePlan={onCreatePlan}
            onUpdatePlan={onUpdatePlan}
            onDeletePlan={onDeletePlan}
            onSelectPlan={onSelectPlan}
            onUpdateStep={onUpdateStep}
          />
        )}
        {activeTab === "settings" && (
          <AgentSettings 
            workingDirectory={workingDirectory}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium transition-colors relative",
        active
          ? "text-foreground"
          : "text-[#555] hover:text-[#777]"
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-1 py-0.5 bg-white/[0.08] rounded text-[9px] text-[#888]">
          {badge}
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-violet-500 rounded-t-full" />
      )}
    </button>
  );
}

function AgentSettings({ workingDirectory }: { workingDirectory: string }) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h4 className="text-xs font-medium text-foreground mb-3">Workspace</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 px-3 bg-white/[0.03] rounded-lg">
            <span className="text-[11px] text-[#888]">Directory</span>
            <span className="text-[11px] text-[#666] font-mono truncate max-w-[140px]">
              {workingDirectory}
            </span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-medium text-foreground mb-3">Capabilities</h4>
        <div className="space-y-2">
          <CapabilityItem 
            title="File Operations"
            description="Create, read, update, and delete files"
            enabled={true}
          />
          <CapabilityItem 
            title="Code Execution"
            description="Run code in sandboxed environment"
            enabled={true}
          />
          <CapabilityItem 
            title="Plan Management"
            description="Create and manage multi-step plans"
            enabled={true}
          />
          <CapabilityItem 
            title="Web Search"
            description="Search the web for information"
            enabled={true}
          />
        </div>
      </div>

      <div className="pt-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 text-[10px] text-[#555]">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Agent is active and ready
        </div>
      </div>
    </div>
  );
}

function CapabilityItem({
  title,
  description,
  enabled,
}: {
  title: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 bg-white/[0.02] rounded-lg">
      <div className={cn(
        "w-1.5 h-1.5 rounded-full mt-1.5",
        enabled ? "bg-emerald-500" : "bg-[#444]"
      )} />
      <div className="flex-1">
        <div className="text-[11px] text-[#aaa]">{title}</div>
        <div className="text-[10px] text-[#555]">{description}</div>
      </div>
    </div>
  );
}
