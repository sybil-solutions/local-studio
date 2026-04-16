// CRITICAL
import { posix } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { AppContext } from "../../../types/context";
import { Event } from "../../monitoring/event-manager";
import { AGENT_FILE_EVENT_TYPES, AGENT_TOOL_NAMES, type AgentEventType } from "./contracts";
import { createTextResult } from "./tool-registry-common";
import type { AgentToolRegistryOptions } from "./tool-registry-types";
import {
  buildAgentFileTree,
  mkdirp,
  normalizeAgentPath,
  toFsPath,
} from "../agent-files/helpers";
import { getSessionAgentFs } from "../agent-files/service";
import type { AgentFsApi } from "../agent-files/types";

/**
 * Build agent filesystem tools.
 * @param context - Application context.
 * @param options - Tool registry options.
 * @returns Agent tools.
 */
export const buildAgentFsTools = (
  context: AppContext,
  options: AgentToolRegistryOptions
): AgentTool[] => {
  const sessionId = options.sessionId;
  const emit = options.emitEvent;

  const withAgentFs = async <T>(operation: (fs: AgentFsApi) => Promise<T>): Promise<T> => {
    const agent = await getSessionAgentFs(context, sessionId);
    return operation(agent);
  };
  const publishAgentFsEvent = async (
    eventName: AgentEventType,
    payload: Record<string, unknown>
  ): Promise<void> => {
    emit?.(eventName, payload);
    await context.eventManager.publish(new Event(eventName, payload));
  };

  const listFiles: AgentTool = {
    name: AGENT_TOOL_NAMES.LIST_FILES,
    label: AGENT_TOOL_NAMES.LIST_FILES,
    description: "List files in the agent workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const normalized = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      const recursive = raw["recursive"] !== false;
      try {
        const files = await withAgentFs((fs) => buildAgentFileTree(fs, normalized, recursive));
        await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_FILES_LISTED, {
          session_id: sessionId,
          path: normalized || null,
          recursive,
          files,
        });
        return createTextResult(JSON.stringify(files, null, 2), {
          files,
          path: normalized,
          recursive,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return createTextResult(`Error listing files at "${normalized || "/"}": ${message}`, { path: normalized, error: true });
      }
    },
  };

  const readFile: AgentTool = {
    name: AGENT_TOOL_NAMES.READ_FILE,
    label: AGENT_TOOL_NAMES.READ_FILE,
    description: "Read a file from the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      try {
        const content = await withAgentFs((fs) => fs.readFile(toFsPath(path), "utf8"));
        const bytes = Buffer.byteLength(content, "utf8");
        await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_FILE_READ, {
          session_id: sessionId,
          path,
          bytes,
        });
        return createTextResult(content, { path });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return createTextResult(`Error reading file "${path}": ${message}`, { path, error: true });
      }
    },
  };

  const writeFile: AgentTool = {
    name: AGENT_TOOL_NAMES.WRITE_FILE,
    label: AGENT_TOOL_NAMES.WRITE_FILE,
    description:
      "Write or overwrite a file in the agent workspace. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      const content = typeof raw["content"] === "string" ? raw["content"] : "";
      const parentDirectory = posix.dirname(path);
      if (parentDirectory && parentDirectory !== ".") {
        await withAgentFs((fs) => mkdirp(fs, parentDirectory));
      }
      await withAgentFs((fs) => fs.writeFile(toFsPath(path), content));
      context.stores.chatStore.addAgentFileVersion(
        sessionId,
        path,
        content,
        Buffer.byteLength(content, "utf8")
      );
      const bytes = Buffer.byteLength(content, "utf8");
      await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_FILE_WRITTEN, {
        session_id: sessionId,
        path,
        bytes,
        encoding: "utf8",
      });
      return createTextResult(`Wrote ${path}`, { path });
    },
  };

  const deleteFile: AgentTool = {
    name: AGENT_TOOL_NAMES.DELETE_FILE,
    label: AGENT_TOOL_NAMES.DELETE_FILE,
    description: "Delete a file from the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      await withAgentFs((fs) => fs.rm(toFsPath(path), { recursive: true, force: true }));
      context.stores.chatStore.deleteAgentFileVersionsForPath(sessionId, path);
      await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_FILE_DELETED, { session_id: sessionId, path });
      return createTextResult(`Deleted ${path}`, { path });
    },
  };

  const makeDirectory: AgentTool = {
    name: AGENT_TOOL_NAMES.MAKE_DIRECTORY,
    label: AGENT_TOOL_NAMES.MAKE_DIRECTORY,
    description: "Create a directory in the agent workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const path = normalizeAgentPath(typeof raw["path"] === "string" ? raw["path"] : "");
      if (!path) throw new Error("Path is required.");
      await withAgentFs((fs) => mkdirp(fs, path));
      await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_DIRECTORY_CREATED, {
        session_id: sessionId,
        path,
      });
      return createTextResult(`Created directory ${path}`, { path });
    },
  };

  const moveFile: AgentTool = {
    name: AGENT_TOOL_NAMES.MOVE_FILE,
    label: AGENT_TOOL_NAMES.MOVE_FILE,
    description: "Move or rename a file in the agent workspace.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = params as Record<string, unknown>;
      const from = normalizeAgentPath(typeof raw["from"] === "string" ? raw["from"] : "");
      const to = normalizeAgentPath(typeof raw["to"] === "string" ? raw["to"] : "");
      if (!from || !to) throw new Error("from and to are required.");
      const targetDirectory = posix.dirname(to);
      if (targetDirectory && targetDirectory !== ".") {
        await withAgentFs((fs) => mkdirp(fs, targetDirectory));
      }
      await withAgentFs((fs) => fs.rename(toFsPath(from), toFsPath(to)));
      context.stores.chatStore.moveAgentFileVersions(sessionId, from, to);
      await publishAgentFsEvent(AGENT_FILE_EVENT_TYPES.AGENT_FILE_MOVED, {
        session_id: sessionId,
        from,
        to,
      });
      return createTextResult(`Moved ${from} to ${to}`, { from, to });
    },
  };

  return [listFiles, readFile, writeFile, deleteFile, makeDirectory, moveFile];
};
