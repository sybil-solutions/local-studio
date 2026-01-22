import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "../types/models";

/**
 * SQLite-backed MCP server store.
 */
export class McpStore {
  private readonly db: Database;

  /**
   * Create an MCP store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  /**
   * Initialize schema and seed default server.
   * @returns void
   */
  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        description TEXT,
        url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const exaApiKey = process.env["EXA_API_KEY"] ?? "";
    const seed = this.resolveExaCommand();

    this.db.query(`
      INSERT OR IGNORE INTO mcp_servers (id, name, enabled, command, args, env, description, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "exa",
      "Exa Search",
      1,
      seed.command,
      JSON.stringify(seed.args),
      JSON.stringify({ EXA_API_KEY: exaApiKey }),
      "Web search and content retrieval via Exa AI",
      "https://exa.ai",
    );
  }

  /**
   * Resolve the best command to run exa-mcp-server.
   * @returns Command and args.
   */
  private resolveExaCommand(): { command: string; args: string[] } {
    const nvmRoot = join(process.env["HOME"] ?? "", ".nvm", "versions", "node");
    if (existsSync(nvmRoot)) {
      try {
        const versions = readdirSync(nvmRoot);
        for (const version of versions) {
          const exaPath = join(nvmRoot, version, "lib", "node_modules", "exa-mcp-server", ".smithery", "stdio", "index.cjs");
          if (existsSync(exaPath)) {
            const nodePath = this.findOnPath("node");
            if (nodePath) {
              return { command: nodePath, args: [exaPath] };
            }
          }
        }
      } catch {
        return { command: "npx", args: ["-y", "exa-mcp-server"] };
      }
    }
    return { command: "npx", args: ["-y", "exa-mcp-server"] };
  }

  /**
   * Find an executable on PATH.
   * @param command - Command name.
   * @returns Resolved path or undefined.
   */
  private findOnPath(command: string): string | undefined {
    const paths = (process.env["PATH"] ?? "").split(":");
    for (const pathEntry of paths) {
      const full = join(pathEntry, command);
      if (existsSync(full)) {
        return full;
      }
    }
    return undefined;
  }

  /**
   * List all MCP servers.
   * @param enabledOnly - Whether to filter by enabled.
   * @returns List of servers.
   */
  public list(enabledOnly = false): McpServer[] {
    const rows = enabledOnly
      ? (this.db.query("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name").all() as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM mcp_servers ORDER BY name").all() as Array<Record<string, unknown>>);

    return rows.map((row) => ({
      id: String(row["id"]),
      name: String(row["name"]),
      enabled: Boolean(row["enabled"]),
      command: String(row["command"]),
      args: JSON.parse(String(row["args"])),
      env: JSON.parse(String(row["env"])),
      description: row["description"] ? String(row["description"]) : null,
      url: row["url"] ? String(row["url"]) : null,
    }));
  }

  /**
   * Get a single MCP server.
   * @param serverId - Server identifier.
   * @returns MCP server or null.
   */
  public get(serverId: string): McpServer | null {
    const row = this.db.query("SELECT * FROM mcp_servers WHERE id = ?").get(serverId) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      enabled: Boolean(row["enabled"]),
      command: String(row["command"]),
      args: JSON.parse(String(row["args"])),
      env: JSON.parse(String(row["env"])),
      description: row["description"] ? String(row["description"]) : null,
      url: row["url"] ? String(row["url"]) : null,
    };
  }

  /**
   * Save or update an MCP server.
   * @param server - MCP server data.
   * @returns Saved server.
   */
  public save(server: McpServer): McpServer {
    this.db.query(`
      INSERT INTO mcp_servers (id, name, enabled, command, args, env, description, url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        command = excluded.command,
        args = excluded.args,
        env = excluded.env,
        description = excluded.description,
        url = excluded.url,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      server.id,
      server.name,
      server.enabled ? 1 : 0,
      server.command,
      JSON.stringify(server.args),
      JSON.stringify(server.env),
      server.description ?? null,
      server.url ?? null,
    );
    return server;
  }

  /**
   * Delete an MCP server.
   * @param serverId - Server identifier.
   * @returns True if deleted.
   */
  public delete(serverId: string): boolean {
    const result = this.db.query("DELETE FROM mcp_servers WHERE id = ?").run(serverId);
    return result.changes > 0;
  }

  /**
   * Enable or disable a server.
   * @param serverId - Server identifier.
   * @param enabled - Desired enabled state.
   * @returns True if updated.
   */
  public setEnabled(serverId: string, enabled: boolean): boolean {
    const result = this.db
      .query("UPDATE mcp_servers SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(enabled ? 1 : 0, serverId);
    return result.changes > 0;
  }
}
