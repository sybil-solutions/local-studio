import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Harness, Workspace } from "@local-studio/contracts";
import { migrate } from "../core/db";
import { AGENT_HARNESSES } from "./launch-table";

interface Row {
  id: string;
  name: string;
  dir: string;
  harness: string;
  model: string;
  flags: string;
  created_at: number;
  last_open_at: number | null;
  context_window: number | null;
  vision: number | null;
  gateway_url: string | null;
}

export interface WorkspaceRuntime {
  contextWindow: number | null;
  vision: boolean | null;
  gatewayUrl: string | null;
}

export const migrateWorkspaces = (db: Database) =>
  migrate(db, "agents", [
    `CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, dir TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL,
      flags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, last_open_at INTEGER)`,
    `ALTER TABLE workspaces ADD COLUMN context_window INTEGER`,
    `ALTER TABLE workspaces ADD COLUMN vision INTEGER`,
    `ALTER TABLE workspaces ADD COLUMN gateway_url TEXT`,
  ]);

const toWorkspace = (r: Row): Workspace => {
  let flags: string[] = [];
  try {
    const f = JSON.parse(r.flags) as unknown;
    if (Array.isArray(f)) flags = f.filter((x): x is string => typeof x === "string");
  } catch {}
  return {
    id: r.id,
    name: r.name,
    dir: r.dir,
    harness: ((AGENT_HARNESSES as readonly string[]).includes(r.harness) ? r.harness : "claude") as Harness,
    model: r.model,
    flags,
    createdAt: r.created_at,
    lastOpenAt: r.last_open_at,
  };
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";

export const expandDir = (dir: string): string => {
  const d = dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir === "~" ? homedir() : dir;
  return isAbsolute(d) ? resolve(d) : resolve(homedir(), d);
};

export interface WorkspaceStore {
  list(): Workspace[];
  get(id: string): Workspace | undefined;
  runtime(id: string): WorkspaceRuntime | undefined;
  findByDir(dir: string, harness: Harness): Workspace | undefined;
  create(input: { name?: string; dir?: string; harness: Harness; model: string; flags?: string[] }): Workspace;
  opened(id: string, patch: { model: string; flags?: string[] } & WorkspaceRuntime): void;
  remove(id: string): boolean;
}

export const createWorkspaceStore = (db: Database): WorkspaceStore => {
  migrateWorkspaces(db);
  const byId = (id: string) => db.query<Row, [string]>("SELECT * FROM workspaces WHERE id = ?").get(id);
  return {
    list: () => db.query<Row, []>("SELECT * FROM workspaces ORDER BY COALESCE(last_open_at, created_at) DESC").all().map(toWorkspace),
    get: (id) => {
      const r = byId(id);
      return r ? toWorkspace(r) : undefined;
    },
    runtime: (id) => {
      const r = byId(id);
      return r ? { contextWindow: r.context_window, vision: r.vision === null ? null : r.vision === 1, gatewayUrl: r.gateway_url } : undefined;
    },
    findByDir: (dir, harness) => {
      const r = db.query<Row, [string, string]>("SELECT * FROM workspaces WHERE dir = ? AND harness = ? ORDER BY created_at LIMIT 1").get(expandDir(dir), harness);
      return r ? toWorkspace(r) : undefined;
    },
    create({ name, dir, harness, model, flags }) {
      const id = `ws_${randomBytes(4).toString("hex")}`;
      const label = name ?? (dir ? expandDir(dir).split("/").filter(Boolean).pop() : undefined) ?? `${harness}-${id.slice(3)}`;
      const absDir = dir ? expandDir(dir) : join(homedir(), "LocalStudio", "workspaces", slugify(label));
      mkdirSync(absDir, { recursive: true });
      const now = Date.now();
      db.query("INSERT INTO workspaces (id, name, dir, harness, model, flags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        label,
        absDir,
        harness,
        model,
        JSON.stringify(flags ?? []),
        now,
      );
      return toWorkspace(byId(id)!);
    },
    opened(id, p) {
      db.query("UPDATE workspaces SET model = ?, flags = COALESCE(?, flags), last_open_at = ?, context_window = ?, vision = ?, gateway_url = ? WHERE id = ?").run(
        p.model,
        p.flags ? JSON.stringify(p.flags) : null,
        Date.now(),
        p.contextWindow,
        p.vision === null ? null : p.vision ? 1 : 0,
        p.gatewayUrl,
        id,
      );
    },
    remove: (id) => db.query("DELETE FROM workspaces WHERE id = ?").run(id).changes > 0,
  };
};
