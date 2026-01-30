// CRITICAL
import type { Hono } from "hono";
import { posix } from "node:path";
import type { FileSystem } from "agentfs-sdk";
import type { AppContext } from "../types/context";
import { badRequest, notFound } from "../core/errors";
import { getAgentFs } from "../services/agent-fs-store";
import { Event } from "../services/event-manager";

interface AgentFileEntry {
  name: string;
  type: "file" | "dir";
  size?: number;
  children?: AgentFileEntry[];
}

const normalizeAgentPath = (rawPath: string): string => {
  const cleaned = rawPath.replace(/^\/+/, "").trim();
  if (!cleaned) return "";
  const normalized = posix.normalize(cleaned);
  if (normalized === "." || normalized === "") return "";
  if (normalized.startsWith("..") || normalized.includes("/..")) {
    throw badRequest("Invalid path");
  }
  return normalized.replace(/^\/+/, "");
};

const toFsPath = (relativePath: string): string =>
  relativePath ? `/${relativePath}` : "/";

type AgentFsApi = Pick<FileSystem, "readdirPlus" | "mkdir" | "rename" | "stat" | "readFile" | "writeFile" | "rm">;

const buildTree = async (
  fs: AgentFsApi,
  relativePath: string,
  recursive: boolean,
): Promise<AgentFileEntry[]> => {
  const fsPath = toFsPath(relativePath);
  const entries = await fs.readdirPlus(fsPath);
  const mapped = await Promise.all(entries.map(async (entry) => {
    const isDir = entry.stats.isDirectory();
    const nextRelative = relativePath ? posix.join(relativePath, entry.name) : entry.name;
    if (isDir) {
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

const mkdirp = async (fs: AgentFsApi, relativePath: string) => {
  const segments = relativePath.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await fs.mkdir(toFsPath(current));
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "EEXIST") throw err;
    }
  }
};

export const registerAgentFilesRoutes = (app: Hono, context: AppContext): void => {
  app.get("/chats/:sessionId/files", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const agent = await getAgentFs(context, sessionId);
    const pathParam = ctx.req.query("path") ?? "";
    const recursive = ctx.req.query("recursive") !== "false";
    const normalized = normalizeAgentPath(pathParam);
    try {
      const files = await buildTree(agent.fs, normalized, recursive);
      await context.eventManager.publish(new Event("agent_files_listed", {
        session_id: sessionId,
        path: normalized || null,
        recursive,
        files,
      }));
      return ctx.json({ files, path: normalized || undefined });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "ENOENT") throw notFound("Path not found");
      throw err;
    }
  });

  app.get("/chats/:sessionId/files/*", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const rawPath = ctx.req.param("*");
    if (!rawPath) throw badRequest("Path is required");
    const agent = await getAgentFs(context, sessionId);
    const normalized = normalizeAgentPath(rawPath);
    const target = toFsPath(normalized);
    try {
      const stat = await agent.fs.stat(target);
      if (stat.isDirectory()) throw badRequest("Path is a directory");
      const content = await agent.fs.readFile(target, "utf8");
      await context.eventManager.publish(new Event("agent_file_read", {
        session_id: sessionId,
        path: normalized,
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      return ctx.json({ path: normalized, content });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "ENOENT") throw notFound("File not found");
      throw err;
    }
  });

  app.put("/chats/:sessionId/files/*", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const rawPath = ctx.req.param("*");
    if (!rawPath) throw badRequest("Path is required");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const content = typeof body["content"] === "string" ? body["content"] : "";
    const encoding = body["encoding"] === "base64" ? "base64" : "utf8";
    const agent = await getAgentFs(context, sessionId);
    const normalized = normalizeAgentPath(rawPath);
    const target = toFsPath(normalized);
    const data = encoding === "base64" ? Buffer.from(content, "base64") : content;
    await agent.fs.writeFile(target, data);
    const byteLength = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.length;
    await context.eventManager.publish(new Event("agent_file_written", {
      session_id: sessionId,
      path: normalized,
      bytes: byteLength,
      encoding,
    }));
    return ctx.json({ success: true });
  });

  app.delete("/chats/:sessionId/files/*", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const rawPath = ctx.req.param("*");
    if (!rawPath) throw badRequest("Path is required");
    const agent = await getAgentFs(context, sessionId);
    const normalized = normalizeAgentPath(rawPath);
    const target = toFsPath(normalized);
    await agent.fs.rm(target, { recursive: true, force: true });
    await context.eventManager.publish(new Event("agent_file_deleted", { session_id: sessionId, path: normalized }));
    return ctx.json({ success: true });
  });

  app.post("/chats/:sessionId/files/dir", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const rawPath = typeof body["path"] === "string" ? body["path"] : "";
    if (!rawPath) throw badRequest("Path is required");
    const agent = await getAgentFs(context, sessionId);
    const normalized = normalizeAgentPath(rawPath);
    await mkdirp(agent.fs, normalized);
    await context.eventManager.publish(new Event("agent_directory_created", { session_id: sessionId, path: normalized }));
    return ctx.json({ success: true });
  });

  app.post("/chats/:sessionId/files/move", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const from = typeof body["from"] === "string" ? body["from"] : "";
    const to = typeof body["to"] === "string" ? body["to"] : "";
    if (!from || !to) throw badRequest("from and to are required");
    const agent = await getAgentFs(context, sessionId);
    const normalizedFrom = normalizeAgentPath(from);
    const normalizedTo = normalizeAgentPath(to);
    const targetDir = posix.dirname(normalizedTo);
    if (targetDir && targetDir !== ".") {
      await mkdirp(agent.fs, targetDir);
    }
    await agent.fs.rename(toFsPath(normalizedFrom), toFsPath(normalizedTo));
    await context.eventManager.publish(new Event("agent_file_moved", {
      session_id: sessionId,
      from: normalizedFrom,
      to: normalizedTo,
    }));
    return ctx.json({ success: true });
  });
};
