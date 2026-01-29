// CRITICAL
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "@/store";
import { normalizePlanSteps } from "../_components/agent/agent-types";
import type { AgentPlan, AgentPlanStep } from "../_components/agent/agent-types";
import { useAgentFiles } from "./use-agent-files";

/**
 * Synthetic tool definitions injected when agent mode is on.
 * The model calls create_plan to create a checklist, then update_plan
 * to mark each step done/running/blocked as it works.
 */
const CREATE_PLAN_TOOL = {
  name: "create_plan",
  server: "__agent__",
  description:
    "Create or replace the execution plan. Call this BEFORE doing any work. " +
    "Provide an ordered list of tasks. After creating the plan, proceed to execute step 0.",
  inputSchema: {
    type: "object" as const,
    properties: {
      tasks: {
        type: "array" as const,
        description: "Ordered list of plan tasks",
        items: {
          type: "object" as const,
          properties: {
            title: {
              type: "string" as const,
              description: "Short description of this task",
            },
            status: {
              type: "string" as const,
              enum: ["pending", "running", "done", "blocked"] as const,
            },
            notes: {
              type: "string" as const,
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["tasks"],
  },
};

// Backwards-compatible alias. Some models/prompts may call `set_plan`.
const SET_PLAN_TOOL = {
  ...CREATE_PLAN_TOOL,
  name: "set_plan",
  description:
    "Alias for create_plan. Create or replace the execution plan. " +
    "Provide an ordered list of tasks. After creating the plan, proceed to execute step 0.",
};

const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  server: "__agent__",
  description:
    "Update the plan by adding, editing, completing, or deleting a task. " +
    "Always keep the plan current.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string" as const,
        enum: ["add", "edit", "update", "delete", "complete", "status"] as const,
        description: "Action to perform on the plan",
      },
      step_index: {
        type: "number" as const,
        description: "Zero-based index of the task to modify",
      },
      title: {
        type: "string" as const,
        description: "Task title (for add/edit)",
      },
      status: {
        type: "string" as const,
        enum: ["pending", "running", "done", "blocked"] as const,
        description: "New status (for status/edit)",
      },
      notes: {
        type: "string" as const,
        description: "Optional notes",
      },
    },
    required: ["action"],
  },
};

const LIST_FILES_TOOL = {
  name: "list_files",
  server: "__agent__",
  description: "List files in the agent workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Optional subdirectory" },
      recursive: { type: "boolean" as const, description: "Recursively list" },
    },
  },
};

const READ_FILE_TOOL = {
  name: "read_file",
  server: "__agent__",
  description: "Read a file from the agent workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Relative path" },
    },
    required: ["path"],
  },
};

const WRITE_FILE_TOOL = {
  name: "write_file",
  server: "__agent__",
  description: "Write or overwrite a file in the agent workspace. Parent directories are created automatically - no need to call make_directory first.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Relative path (e.g. 'research/notes.md')" },
      content: { type: "string" as const, description: "File contents" },
    },
    required: ["path", "content"],
  },
};

const DELETE_FILE_TOOL = {
  name: "delete_file",
  server: "__agent__",
  description: "Delete a file from the agent workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const },
    },
    required: ["path"],
  },
};

const MKDIR_TOOL = {
  name: "make_directory",
  server: "__agent__",
  description: "Create a directory in the agent workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const },
    },
    required: ["path"],
  },
};

const MOVE_FILE_TOOL = {
  name: "move_file",
  server: "__agent__",
  description: "Move or rename a file in the agent workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: { type: "string" as const },
      to: { type: "string" as const },
    },
    required: ["from", "to"],
  },
};

/**
 * Extract a string argument from various possible locations in the args object.
 * Models may put arguments in different places depending on the provider.
 */
const extractStringArg = (args: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  // Try looking in nested 'arguments' or 'input' objects
  const nested = args.arguments ?? args.input;
  if (nested && typeof nested === "object") {
    for (const key of keys) {
      const val = (nested as Record<string, unknown>)[key];
      if (typeof val === "string" && val.trim()) return val.trim();
    }
  }
  return "";
};

const normalizePlanStatus = (value: unknown): AgentPlanStep["status"] => {
  if (typeof value !== "string") return "pending";
  const normalized = value.toLowerCase().trim();
  if (normalized === "complete" || normalized === "completed" || normalized === "done" || normalized === "finished") {
    return "done";
  }
  if (normalized === "running" || normalized === "in_progress" || normalized === "in-progress" || normalized === "active" || normalized === "working") {
    return "running";
  }
  if (normalized === "blocked" || normalized === "failed" || normalized === "error") {
    return "blocked";
  }
  if (normalized === "pending" || normalized === "waiting" || normalized === "queued" || normalized === "todo") {
    return "pending";
  }
  return "pending";
};

export function useAgentTools() {
  const agentPlan = useAppStore((s) => s.agentPlan);
  const setAgentPlan = useAppStore((s) => s.setAgentPlan);

  const {
    loadAgentFiles,
    readAgentFile,
    writeAgentFile,
    deleteAgentFile,
    createAgentDirectory,
    moveAgentFile,
  } = useAgentFiles();

  // Live ref so executeAgentTool always reads the latest plan,
  // even when called multiple times within the same streaming response
  // before React re-renders.
  const planRef = useRef<AgentPlan | null>(agentPlan);
  useEffect(() => { planRef.current = agentPlan; }, [agentPlan]);
  /** The tool defs to merge into the tool list */
  const agentToolDefs = useMemo(
    () => [
      CREATE_PLAN_TOOL,
      SET_PLAN_TOOL,
      UPDATE_PLAN_TOOL,
      LIST_FILES_TOOL,
      READ_FILE_TOOL,
      WRITE_FILE_TOOL,
      DELETE_FILE_TOOL,
      MKDIR_TOOL,
      MOVE_FILE_TOOL,
    ],
    [],
  );

  /** Handle a synthetic agent tool call. Returns the tool result string. */
  const executeAgentTool = useCallback(
    async (
      toolName: string,
      args: Record<string, unknown>,
      options?: { sessionId?: string | null },
    ): Promise<string | null> => {
      const normalizedToolName = toolName === "set_plan" ? "create_plan" : toolName;

      if (normalizedToolName === "create_plan") {
        console.log("[create_plan] Raw args:", JSON.stringify(args, null, 2));
        const planArg = args.plan as Record<string, unknown> | undefined;

        // Try multiple ways to extract tasks
        let rawTasks: unknown = args.tasks ?? args.steps ?? planArg?.tasks ?? planArg?.steps;

        // If args itself is an array, it might be the tasks directly
        if (!rawTasks && Array.isArray(args)) {
          console.log("[create_plan] args is an array, using directly");
          rawTasks = args;
        }

        // Check if args has a nested 'arguments' wrapper (some models do this)
        if (!rawTasks && args.arguments) {
          const nested = args.arguments as Record<string, unknown>;
          rawTasks = nested.tasks ?? nested.steps;
          console.log("[create_plan] Found nested arguments:", nested);
        }

        // If rawTasks is still a string, try parsing it
        if (typeof rawTasks === "string") {
          try {
            rawTasks = JSON.parse(rawTasks);
            console.log("[create_plan] Parsed string tasks:", rawTasks);
          } catch {
            // ignore
          }
        }

        // Last resort: look for any array property in args
        if (!rawTasks || (Array.isArray(rawTasks) && rawTasks.length === 0)) {
          for (const [key, value] of Object.entries(args)) {
            if (Array.isArray(value) && value.length > 0) {
              console.log(`[create_plan] Found array in args.${key}:`, value);
              // Check if it looks like tasks (has objects with title or string elements)
              const firstItem = value[0];
              if (
                typeof firstItem === "string" ||
                (typeof firstItem === "object" && firstItem !== null && ("title" in firstItem || "name" in firstItem))
              ) {
                rawTasks = value;
                break;
              }
            }
          }
        }

        // Handle case where items have "name" instead of "title"
        if (Array.isArray(rawTasks)) {
          rawTasks = rawTasks.map((item) => {
            if (typeof item === "object" && item !== null) {
              const obj = item as Record<string, unknown>;
              if (!obj.title && obj.name && typeof obj.name === "string") {
                return { ...obj, title: obj.name };
              }
            }
            return item;
          });
        }

        console.log("[create_plan] Final rawTasks:", rawTasks, "type:", typeof rawTasks, "isArray:", Array.isArray(rawTasks));
        const steps = normalizePlanSteps(rawTasks);
        if (steps.length === 0) {
          const receivedKeys = Object.keys(args);
          console.error("[create_plan] Failed to extract tasks. Args keys:", receivedKeys);
          return JSON.stringify({
            success: false,
            error:
              "Plan must include a tasks array with a title for each task.",
            hint: 'Example: create_plan({ tasks: [{ title: "Research topic" }, { title: "Draft outline" }] })',
            received: {
              keys: receivedKeys,
              hasTasksKey: "tasks" in args,
              tasksType: typeof args.tasks,
              rawArgs: args,
            },
          });
        }
        const plan: AgentPlan = {
          steps,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        console.log("[create_plan] SUCCESS! Setting plan:", plan);
        planRef.current = plan;
        setAgentPlan(plan);
        console.log("[create_plan] Plan set in Zustand. planRef.current:", planRef.current);
        return JSON.stringify({
          success: true,
          plan: { steps: plan.steps },
          message: `Plan created with ${steps.length} steps. Proceed to execute step 0.`,
        });
      }

      if (normalizedToolName === "update_plan") {
        console.log("[update_plan] Raw args:", JSON.stringify(args, null, 2));
        const live = planRef.current;
        if (!live) {
          console.error("[update_plan] No active plan!");
          return JSON.stringify({
            success: false,
            error: "No active plan. Call create_plan first.",
          });
        }
        console.log("[update_plan] Current plan has", live.steps.length, "steps");

        // Flexible action extraction
        let rawAction = typeof args.action === "string" ? args.action.toLowerCase() : "";
        // Infer action from status if not provided
        const rawStatus = typeof args.status === "string" ? args.status.toLowerCase() : "";
        if (!rawAction && rawStatus) {
          if (rawStatus === "done" || rawStatus === "complete" || rawStatus === "completed") {
            rawAction = "complete";
          } else if (rawStatus === "running" || rawStatus === "in_progress") {
            rawAction = "status";
          } else {
            rawAction = "status";
          }
        }
        if (!rawAction) rawAction = "status";

        console.log("[update_plan] Action:", rawAction, "step_index:", args.step_index, "index:", args.index, "status:", args.status, "task_index:", args.task_index);

        const action =
          rawAction === "update" || rawAction === "edit" || rawAction === "add" || rawAction === "delete" ||
          rawAction === "complete" || rawAction === "status" || rawAction === "done"
            ? (rawAction === "done" ? "complete" : rawAction)
            : "status";

        // Flexible index extraction - try multiple property names
        const rawIdx = args.step_index ?? args.index ?? args.task_index ?? args.stepIndex ?? args.taskIndex ?? args.step ?? args.task;
        let idx =
          typeof rawIdx === "number"
            ? rawIdx
            : typeof rawIdx === "string"
              ? parseInt(rawIdx, 10)
              : -1;

        // If no index provided but we want to complete, try to find the current running step
        if (idx < 0 && (action === "complete" || action === "status")) {
          const runningIdx = live.steps.findIndex((s) => s.status === "running");
          const pendingIdx = live.steps.findIndex((s) => s.status === "pending");
          if (runningIdx >= 0) {
            idx = runningIdx;
            console.log("[update_plan] Auto-selected running step:", idx);
          } else if (pendingIdx >= 0 && action === "status") {
            idx = pendingIdx;
            console.log("[update_plan] Auto-selected pending step:", idx);
          }
        }

        console.log("[update_plan] Final idx:", idx, "action:", action);
        const maxIdx = live.steps.length - 1;
        const title = typeof args.title === "string" ? args.title.trim() : "";
        const status = normalizePlanStatus(args.status);
        const notes =
          typeof args.notes === "string" && args.notes.trim()
            ? args.notes.trim()
            : undefined;

        if (action !== "add" && (!Number.isFinite(idx) || idx < 0 || idx > maxIdx)) {
          return JSON.stringify({
            success: false,
            error: `Invalid step_index: ${idx}. Valid range is 0–${maxIdx}.`,
            currentPlan: live.steps.map(
              (s, i) => `${i}: ${s.title} [${s.status}]`,
            ),
          });
        }

        let updatedSteps = [...live.steps];

        if (action === "add") {
          if (!title) {
            return JSON.stringify({
              success: false,
              error: "title is required to add a task.",
            });
          }
          updatedSteps = [
            ...updatedSteps,
            {
              id: `step-${Date.now()}`,
              title,
              status,
              ...(notes ? { notes } : {}),
            },
          ];
        } else if (action === "delete") {
          updatedSteps = updatedSteps.filter((_, i) => i !== idx);
        } else if (action === "complete") {
          updatedSteps = updatedSteps.map((s, i) =>
            i === idx ? { ...s, status: "done", ...(notes ? { notes } : {}) } : s,
          );
        } else {
          const hasEdits = Boolean(title || notes || args.status);
          if (!hasEdits) {
            return JSON.stringify({
              success: false,
              error: "Provide title, status, or notes to edit.",
            });
          }
          updatedSteps = updatedSteps.map((s, i) =>
            i === idx
              ? {
                  ...s,
                  ...(title ? { title } : {}),
                  ...(args.status ? { status } : {}),
                  ...(notes ? { notes } : {}),
                }
              : s,
          );
        }

        const updated: AgentPlan = {
          ...live,
          steps: updatedSteps,
          updatedAt: Date.now(),
        };
        console.log("[update_plan] SUCCESS! Updated steps:", updatedSteps.map(s => `${s.title}: ${s.status}`));
        planRef.current = updated;
        setAgentPlan(updated);
        console.log("[update_plan] Plan updated in Zustand");

        const doneCount = updatedSteps.filter(
          (s) => s.status === "done",
        ).length;
        const nextIdx = updatedSteps.findIndex(
          (s) => s.status !== "done",
        );

        return JSON.stringify({
          success: true,
          action,
          step: action === "add" ? updatedSteps.length - 1 : idx,
          progress: `${doneCount}/${updatedSteps.length}`,
          ...(nextIdx >= 0
            ? { nextStep: nextIdx, nextTitle: updatedSteps[nextIdx].title }
            : { allDone: true }),
        });
      }

      if (toolName === "list_files") {
        try {
          const path = typeof args.path === "string" ? args.path : undefined;
          const recursive = typeof args.recursive === "boolean" ? args.recursive : undefined;
          const files = await loadAgentFiles({
            sessionId: options?.sessionId ?? undefined,
            path,
            recursive,
          });
          return JSON.stringify({ success: true, files });
        } catch (err) {
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (toolName === "read_file") {
        console.log("[read_file] Raw args:", JSON.stringify(args, null, 2));
        const path = extractStringArg(args, "path", "filepath", "file_path", "filename", "file");
        if (!path) {
          return JSON.stringify({
            success: false,
            error: "path is required",
            hint: 'Example: read_file({ path: "notes.md" })',
            received: Object.keys(args),
          });
        }
        try {
          const result = await readAgentFile(path, options?.sessionId ?? undefined);
          return JSON.stringify({
            success: true,
            path: result.path,
            content: result.content,
          });
        } catch (err) {
          console.error("[read_file] FAILED:", err);
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (toolName === "write_file") {
        console.log("[write_file] Raw args:", JSON.stringify(args, null, 2));
        const path = extractStringArg(args, "path", "filepath", "file_path", "filename", "file");
        const content = extractStringArg(args, "content", "contents", "text", "data", "body");
        console.log("[write_file] path:", path, "content length:", content.length, "sessionId:", options?.sessionId);
        if (!path) {
          return JSON.stringify({
            success: false,
            error: "path is required",
            hint: 'Example: write_file({ path: "notes.md", content: "# Notes\\n..." })',
            received: Object.keys(args),
          });
        }
        try {
          console.log("[write_file] Calling writeAgentFile...");
          await writeAgentFile(path, content, options?.sessionId ?? undefined);
          console.log("[write_file] SUCCESS! File written and files reloaded");
          return JSON.stringify({ success: true, path, message: "File written successfully. Parent directories created automatically." });
        } catch (err) {
          console.error("[write_file] FAILED:", err);
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (toolName === "delete_file") {
        console.log("[delete_file] Raw args:", JSON.stringify(args, null, 2));
        const path = extractStringArg(args, "path", "filepath", "file_path", "filename", "file");
        if (!path) {
          return JSON.stringify({
            success: false,
            error: "path is required",
            hint: 'Example: delete_file({ path: "old_notes.md" })',
            received: Object.keys(args),
          });
        }
        try {
          await deleteAgentFile(path, options?.sessionId ?? undefined);
          return JSON.stringify({ success: true, path });
        } catch (err) {
          console.error("[delete_file] FAILED:", err);
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (toolName === "make_directory") {
        console.log("[make_directory] Raw args:", JSON.stringify(args, null, 2));
        const path = extractStringArg(args, "path", "directory", "dir", "dirname", "folder");
        if (!path) {
          return JSON.stringify({
            success: false,
            error: "path is required",
            hint: 'Example: make_directory({ path: "research" }). Note: write_file creates parent directories automatically.',
            received: Object.keys(args),
          });
        }
        try {
          await createAgentDirectory(path, options?.sessionId ?? undefined);
          return JSON.stringify({ success: true, path, message: "Directory created. Note: write_file creates parent directories automatically." });
        } catch (err) {
          console.error("[make_directory] FAILED:", err);
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (toolName === "move_file") {
        console.log("[move_file] Raw args:", JSON.stringify(args, null, 2));
        const from = extractStringArg(args, "from", "source", "src", "old_path", "oldPath");
        const to = extractStringArg(args, "to", "destination", "dest", "new_path", "newPath", "target");
        if (!from || !to) {
          return JSON.stringify({
            success: false,
            error: "from and to are required",
            hint: 'Example: move_file({ from: "old.md", to: "new.md" })',
            received: Object.keys(args),
          });
        }
        try {
          await moveAgentFile(from, to, options?.sessionId ?? undefined);
          return JSON.stringify({ success: true, from, to });
        } catch (err) {
          console.error("[move_file] FAILED:", err);
          return JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return null; // not an agent tool
    },
    [
      setAgentPlan,
      loadAgentFiles,
      readAgentFile,
      writeAgentFile,
      deleteAgentFile,
      createAgentDirectory,
      moveAgentFile,
    ],
  );

  /** Check if a tool name is a synthetic agent tool */
  const isAgentTool = useCallback(
    (toolName: string) =>
      toolName === "create_plan" ||
      toolName === "set_plan" ||
      toolName === "update_plan" ||
      toolName === "list_files" ||
      toolName === "read_file" ||
      toolName === "write_file" ||
      toolName === "delete_file" ||
      toolName === "make_directory" ||
      toolName === "move_file",
    [],
  );

  return {
    agentToolDefs,
    executeAgentTool,
    isAgentTool,
    agentPlan,
    clearPlan: useCallback(() => {
      planRef.current = null;
      setAgentPlan(null);
    }, [setAgentPlan]),
  };
}
