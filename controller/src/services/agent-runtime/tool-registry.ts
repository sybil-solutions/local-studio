// CRITICAL
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import type { AppContext } from "../../types/context";
import type { McpServer } from "../../types/models";
import { runMcpCommand } from "../mcp-runner";
import { getAgentFs } from "../agent-fs-store";
import { Event } from "../event-manager";

export interface AgentToolRegistryOptions {
  sessionId: string;
  mcpEnabled: boolean;
  agentMode: boolean;
  agentFiles?: boolean;
  emitEvent?: (type: string, data: Record<string, unknown>) => void;
}

interface AgentFileEntry {
  name: string;
  type: "file" | "dir";
  size?: number;
  children?: AgentFileEntry[];
}

type AgentFsApi = {
  readdirPlus: (path: string) => Promise<Array<{ name: string; stats: { isDirectory: () => boolean; size: number } }>>;
  mkdir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, data: string | Buffer) => Promise<void>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
};

const normalizeAgentPath = (rawPath: string): string => {
  const cleaned = rawPath.replace(/^\/+/, "").trim();
  if (!cleaned) return "";
  const normalized = posix.normalize(cleaned);
  if (normalized === "." || normalized === "") return "";
  if (normalized.startsWith("..") || normalized.includes("/..")) {
    throw new Error("Invalid path");
  }
  return normalized.replace(/^\/+/, "");
};

const toFsPath = (relativePath: string): string =>
  relativePath ? `/${relativePath}` : "/";

const buildTree = async (
  fs: AgentFsApi,
  relativePath: string,
  recursive: boolean,
): Promise<AgentFileEntry[]> => {
  const fsPath = toFsPath(relativePath);
  const entries = await fs.readdirPlus(fsPath);
  const mapped = await Promise.all(entries.map(async (entry) => {
    const isDirectory = entry.stats.isDirectory();
    const nextRelative = relativePath ? posix.join(relativePath, entry.name) : entry.name;
    if (isDirectory) {
      return {
        name: entry.name,
        type: "dir" as const,
        children: recursive ? await buildTree(fs, nextRelative, recursive) : [],
      };
    }
    return {
      name: entry.name,
      type: "file" as const,
      size: entry.stats.size,
    };
  }));
  return mapped.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "dir" ? -1 : 1;
  });
};

const mkdirp = async (fs: AgentFsApi, relativePath: string): Promise<void> => {
  const segments = relativePath.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await fs.mkdir(toFsPath(current));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "EEXIST") throw error;
    }
  }
};

const createTextResult = (text: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> => ({
  content: [{ type: "text", text } satisfies TextContent],
  details,
});

const sanitizeToolArguments = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = { ...args };
  if (toolName === "get_code_context_exa") {
    const tokensNumber = Number(sanitized["tokensNum"] ?? 0);
    if (tokensNumber < 1000) {
      sanitized["tokensNum"] = 5000;
    }
  }
  return sanitized;
};

const loadAgentPlan = (context: AppContext, sessionId: string): Record<string, unknown> | null => {
  const session = context.stores.chatStore.getSessionSummary(sessionId);
  if (!session) return null;
  const raw = session["agent_state"];
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
};

const normalizePlanStatus = (value: unknown): "pending" | "running" | "done" | "blocked" => {
  switch (value) {
    case "running":
    case "done":
    case "blocked":
      return value;
    default:
      return "pending";
  }
};

const normalizePlanSteps = (tasks: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(tasks)) return [];
  const steps: Array<Record<string, unknown>> = [];
  for (const task of tasks) {
    if (!task) continue;
    if (typeof task === "string") {
      const title = task.trim();
      if (!title) continue;
      steps.push({
        id: randomUUID(),
        title,
        status: "pending",
      });
      continue;
    }
    if (typeof task !== "object") continue;
    const record = task as Record<string, unknown>;
    const titleCandidate = (
      record["title"] ??
      record["name"] ??
      record["step"] ??
      record["task"] ??
      record["description"]
    );
    const title = typeof titleCandidate === "string" ? titleCandidate.trim() : "";
    if (!title) continue;
    steps.push({
      id: typeof record["id"] === "string" ? record["id"] : randomUUID(),
      title,
      status: normalizePlanStatus(record["status"]),
      ...(typeof record["notes"] === "string" && record["notes"].trim() ? { notes: record["notes"] } : {}),
    });
  }
  return steps;
};

const persistAgentPlan = (
  context: AppContext,
  sessionId: string,
  plan: Record<string, unknown> | null,
): void => {
  const agentState = plan
    ? { plan, tasks: (plan["steps"] as Array<Record<string, unknown>> | undefined) ?? undefined }
    : null;
  context.stores.chatStore.updateSession(sessionId, undefined, undefined, agentState);
};

const buildPlanTools = (context: AppContext, options: AgentToolRegistryOptions): AgentTool[] => {
  const emit = options.emitEvent;

  const createPlanTool = (name: string, description: string): AgentTool => ({
    name,
    label: name,
    description,
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "running", "done", "blocked"] },
              notes: { type: "string" },
            },
            required: ["title"],
          },
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "running", "done", "blocked"] },
              notes: { type: "string" },
            },
            required: ["title"],
          },
        },
        plan: { type: "object" },
      },
      required: [],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const planArgument = raw["plan"] as Record<string, unknown> | undefined;
      const tasks = raw["tasks"] ?? raw["steps"] ?? planArgument?.["tasks"] ?? planArgument?.["steps"];
      const steps = normalizePlanSteps(tasks);
      if (steps.length === 0) {
        throw new Error("No valid plan steps provided.");
      }
      const now = Date.now();
      const plan = { steps, createdAt: now, updatedAt: now };
      persistAgentPlan(context, options.sessionId, plan);
      emit?.("plan_updated", { session_id: options.sessionId, plan });
      await context.eventManager.publish(new Event("agent_plan_updated", { session_id: options.sessionId, plan }));
      return createTextResult("Plan created.", { plan });
    },
  });

  const updatePlanTool: AgentTool = {
    name: "update_plan",
    label: "update_plan",
    description: "Update the plan by adding, editing, completing, or deleting a step.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "edit", "update", "delete", "complete", "status"] },
        step_index: { type: "number" },
        title: { type: "string" },
        status: { type: "string", enum: ["pending", "running", "done", "blocked"] },
        notes: { type: "string" },
      },
      required: ["action"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const action = typeof raw["action"] === "string" ? raw["action"] : "";
      const stepIndex = typeof raw["step_index"] === "number" ? raw["step_index"] : -1;
      const currentState = loadAgentPlan(context, options.sessionId);
      const currentPlan = currentState?.["plan"] as Record<string, unknown> | undefined;
      const steps = normalizePlanSteps(currentPlan?.["steps"] ?? currentState?.["tasks"]);
      if (steps.length === 0) {
        throw new Error("No active plan. Call create_plan first.");
      }

      if (["add"].includes(action)) {
        const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
        if (!title) throw new Error("Title is required for add.");
        steps.push({
          id: randomUUID(),
          title,
          status: normalizePlanStatus(raw["status"]),
          ...(typeof raw["notes"] === "string" && raw["notes"].trim() ? { notes: raw["notes"] } : {}),
        });
      } else {
        if (stepIndex < 0 || stepIndex >= steps.length) {
          throw new Error("Invalid step_index.");
        }
        const step = steps[stepIndex] ?? {};
        if (action === "delete") {
          steps.splice(stepIndex, 1);
        } else if (action === "complete") {
          step["status"] = "done";
        } else if (action === "status") {
          step["status"] = normalizePlanStatus(raw["status"]);
        } else if (action === "edit" || action === "update") {
          if (typeof raw["title"] === "string" && raw["title"].trim()) {
            step["title"] = raw["title"].trim();
          }
          if (raw["status"] !== undefined) {
            step["status"] = normalizePlanStatus(raw["status"]);
          }
          if (typeof raw["notes"] === "string") {
            step["notes"] = raw["notes"];
          }
        } else {
          throw new Error(`Unsupported action: ${action}`);
        }
        steps[stepIndex] = step;
      }

      const now = Date.now();
      const plan = {
        steps,
        createdAt: typeof currentPlan?.["createdAt"] === "number" ? currentPlan["createdAt"] : now,
        updatedAt: now,
      };
      persistAgentPlan(context, options.sessionId, plan);
      emit?.("plan_updated", { session_id: options.sessionId, plan });
      await context.eventManager.publish(new Event("agent_plan_updated", { session_id: options.sessionId, plan }));
      return createTextResult("Plan updated.", { plan });
    },
  };

  return [
    createPlanTool(
      "create_plan",
      "Create or replace the execution plan. Call this once before doing any work.",
    ),
    createPlanTool(
      "set_plan",
      "Alias for create_plan. Create or replace the execution plan.",
    ),
    updatePlanTool,
  ];
};

const buildAgentFsTools = (context: AppContext, options: AgentToolRegistryOptions): AgentTool[] => {
  const sessionId = options.sessionId;
  const emit = options.emitEvent;

  const withAgentFs = async <T>(operation: (fs: AgentFsApi) => Promise<T>): Promise<T> => {
    const agent = await getAgentFs(context, sessionId);
    return operation(agent.fs as AgentFsApi);
  };

  const listFiles: AgentTool = {
    name: "list_files",
    label: "list_files",
    description: "List files in the agent workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const normalized = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      const recursive = raw["recursive"] !== false;
      const files = await withAgentFs((fs) => buildTree(fs, normalized, recursive));
      emit?.("agent_files_listed", { session_id: sessionId, path: normalized || null, recursive, files });
      await context.eventManager.publish(new Event("agent_files_listed", {
        session_id: sessionId,
        path: normalized || null,
        recursive,
        files,
      }));
      return createTextResult(JSON.stringify(files, null, 2), { files, path: normalized, recursive });
    },
  };

  const readFile: AgentTool = {
    name: "read_file",
    label: "read_file",
    description: "Read a file from the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      const content = await withAgentFs((fs) => fs.readFile(toFsPath(path), "utf8"));
      emit?.("agent_file_read", { session_id: sessionId, path, bytes: Buffer.byteLength(content, "utf8") });
      await context.eventManager.publish(new Event("agent_file_read", {
        session_id: sessionId,
        path,
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      return createTextResult(content, { path });
    },
  };

  const writeFile: AgentTool = {
    name: "write_file",
    label: "write_file",
    description: "Write or overwrite a file in the agent workspace. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      const content = typeof raw["content"] === "string" ? raw["content"] : "";
      await withAgentFs((fs) => fs.writeFile(toFsPath(path), content));
      emit?.("agent_file_written", { session_id: sessionId, path, bytes: Buffer.byteLength(content, "utf8") });
      await context.eventManager.publish(new Event("agent_file_written", {
        session_id: sessionId,
        path,
        bytes: Buffer.byteLength(content, "utf8"),
        encoding: "utf8",
      }));
      return createTextResult(`Wrote ${path}`, { path });
    },
  };

  const deleteFile: AgentTool = {
    name: "delete_file",
    label: "delete_file",
    description: "Delete a file from the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      await withAgentFs((fs) => fs.rm(toFsPath(path), { recursive: true, force: true }));
      emit?.("agent_file_deleted", { session_id: sessionId, path });
      await context.eventManager.publish(new Event("agent_file_deleted", { session_id: sessionId, path }));
      return createTextResult(`Deleted ${path}`, { path });
    },
  };

  const makeDirectory: AgentTool = {
    name: "make_directory",
    label: "make_directory",
    description: "Create a directory in the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      await withAgentFs((fs) => mkdirp(fs, path));
      emit?.("agent_directory_created", { session_id: sessionId, path });
      await context.eventManager.publish(new Event("agent_directory_created", { session_id: sessionId, path }));
      return createTextResult(`Created directory ${path}`, { path });
    },
  };

  const moveFile: AgentTool = {
    name: "move_file",
    label: "move_file",
    description: "Move or rename a file in the agent workspace.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    } as unknown as TSchema,
    execute: async (
      _toolCallId,
      params,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const from = normalizeAgentPath(typeof raw["from"] === "string" ? raw["from"] : "");
      const to = normalizeAgentPath(typeof raw["to"] === "string" ? raw["to"] : "");
      if (!from || !to) throw new Error("from and to are required.");
      await withAgentFs((fs) => fs.rename(toFsPath(from), toFsPath(to)));
      emit?.("agent_file_moved", { session_id: sessionId, from, to });
      await context.eventManager.publish(new Event("agent_file_moved", { session_id: sessionId, from, to }));
      return createTextResult(`Moved ${from} to ${to}`, { from, to });
    },
  };

  return [listFiles, readFile, writeFile, deleteFile, makeDirectory, moveFile];
};

const buildMcpTools = async (context: AppContext): Promise<AgentTool[]> => {
  const servers = context.stores.mcpStore.list(true);
  const tools: AgentTool[] = [];

  for (const server of servers) {
    let result: Record<string, unknown>;
    try {
      result = await runMcpCommand(server as McpServer, "tools/list");
    } catch {
      continue;
    }
    const serverTools = Array.isArray(result["tools"]) ? result["tools"] : [];
    for (const tool of serverTools) {
      if (!tool || typeof tool !== "object") continue;
      const record = tool as Record<string, unknown>;
      const toolName = typeof record["name"] === "string" ? record["name"] : "";
      if (!toolName) continue;
      const fullName = `${server.id}__${toolName}`;
      const description = typeof record["description"] === "string" ? record["description"] : "";
      const inputSchema = (record["inputSchema"] ?? record["input_schema"] ?? {}) as TSchema;
      tools.push({
        name: fullName,
        label: fullName,
        description,
        parameters: inputSchema,
        execute: async (
          _toolCallId,
          params,
        ): Promise<AgentToolResult<Record<string, unknown>>> => {
          const sanitized = sanitizeToolArguments(toolName, params as Record<string, unknown>);
          const callResult = await runMcpCommand(server as McpServer, "tools/call", {
            name: toolName,
            arguments: sanitized,
          });
          const content = Array.isArray(callResult["content"]) ? callResult["content"] : [];
          const textParts: string[] = [];
          for (const item of content) {
            if (item && typeof item === "object" && (item as Record<string, unknown>)["type"] === "text") {
              textParts.push(String((item as Record<string, unknown>)["text"] ?? ""));
            }
          }
          if (textParts.length > 0) {
            return createTextResult(textParts.join("\n"), { raw: callResult });
          }
          return createTextResult(JSON.stringify(callResult, null, 2), { raw: callResult });
        },
      });
    }
  }

  return tools;
};

export const buildAgentTools = async (
  context: AppContext,
  options: AgentToolRegistryOptions,
): Promise<AgentTool[]> => {
  const tools: AgentTool[] = [];
  if (options.mcpEnabled) {
    tools.push(...(await buildMcpTools(context)));
  }
  if (options.agentMode) {
    tools.push(...buildPlanTools(context, options));
  }
  if (options.agentMode || options.agentFiles) {
    tools.push(...buildAgentFsTools(context, options));
  }
  return tools;
};
