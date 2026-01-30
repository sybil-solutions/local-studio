// CRITICAL
"use client";

import { Ban, Check, ClipboardList, Circle, Loader2 } from "lucide-react";
import type { AgentTask } from "@/lib/types";

interface AgentTasksPanelProps {
  tasks: AgentTask[];
}

function TaskIcon({ status }: { status: AgentTask["status"] }) {
  switch (status) {
    case "done":
      return (
        <div className="w-[18px] h-[18px] rounded bg-emerald-500/20 flex items-center justify-center shrink-0">
          <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
        </div>
      );
    case "running":
      return (
        <div className="w-[18px] h-[18px] rounded bg-blue-500/20 flex items-center justify-center shrink-0">
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
        </div>
      );
    case "blocked":
      return (
        <div className="w-[18px] h-[18px] rounded bg-red-500/15 flex items-center justify-center shrink-0">
          <Ban className="h-2.5 w-2.5 text-red-400" />
        </div>
      );
    default:
      return (
        <div className="w-[18px] h-[18px] rounded border border-white/[0.08] flex items-center justify-center shrink-0">
          <Circle className="h-2 w-2 text-[#444]" />
        </div>
      );
  }
}

export function AgentTasksPanel({ tasks }: AgentTasksPanelProps) {
  const doneCount = tasks.filter((task) => task.status === "done").length;

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mb-4">
          <ClipboardList className="h-6 w-6 text-[#444]" />
        </div>
        <p className="text-sm text-[#666] mb-1">No tasks yet</p>
        <p className="text-xs text-[#444] max-w-[220px]">
          Tasks created by the agent will appear here as a running checklist.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[11px] text-[#aaa]">Tasks</span>
        <span className="text-[10px] text-[#555] font-mono">
          {doneCount}/{tasks.length} done
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-2 rounded bg-white/[0.02] px-2.5 py-2">
            <TaskIcon status={task.status} />
            <div className="min-w-0">
              <p
                className={`text-[12px] leading-snug ${task.status === "done" ? "text-[#666] line-through" : "text-[#ccc]"}`}
              >
                {task.title}
              </p>
              {task.notes && (
                <p className="text-[10px] text-[#555] mt-1 whitespace-pre-wrap">{task.notes}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
