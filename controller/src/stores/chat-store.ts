// CRITICAL
import { Database } from "bun:sqlite";

/**
 * SQLite-backed chat session storage.
 */
export class ChatStore {
  private readonly db: Database;

  /**
   * Create a chat store.
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  /**
   * Initialize schema.
   * @returns void
   */
  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        model TEXT,
        parent_id TEXT,
        agent_state TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        model TEXT,
        tool_calls TEXT,
        parts TEXT,
        metadata TEXT,
        request_prompt_tokens INTEGER,
        request_tools_tokens INTEGER,
        request_total_input_tokens INTEGER,
        request_completion_tokens INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id)");
    this.ensureColumn("chat_sessions", "agent_state", "TEXT");
    this.ensureColumn("chat_messages", "parts", "TEXT");
    this.ensureColumn("chat_messages", "metadata", "TEXT");
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
    const exists = columns.some((entry) => entry["name"] === column);
    if (!exists) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  /**
   * List all chat sessions.
   * @returns List of sessions.
   */
  public listSessions(): Array<Record<string, unknown>> {
    const rows = this.db
      .query("SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row }));
  }

  /**
   * Get a session and its messages.
   * @param sessionId - Session identifier.
   * @returns Session object or null.
   */
  public getSession(sessionId: string): Record<string, unknown> | null {
    const session = this.db
      .query("SELECT id, title, model, parent_id, agent_state, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | null;
    if (!session) {
      return null;
    }

    let agentState: unknown = session["agent_state"] ?? null;
    if (typeof agentState === "string") {
      try {
        agentState = JSON.parse(agentState);
      } catch {
        agentState = null;
      }
    }

    const messages = this.db
      .query(`SELECT id, role, content, model, tool_calls, parts, metadata, request_prompt_tokens, request_tools_tokens,
              request_total_input_tokens, request_completion_tokens, created_at
              FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid`)
      .all(sessionId) as Array<Record<string, unknown>>;

    const hydrated = messages.map((message) => {
      const next: Record<string, unknown> = { ...message };
      if (typeof next["tool_calls"] === "string") {
        try {
          next["tool_calls"] = JSON.parse(String(next["tool_calls"]));
        } catch {
          next["tool_calls"] = null;
        }
      }
      if (typeof next["parts"] === "string") {
        try {
          next["parts"] = JSON.parse(String(next["parts"]));
        } catch {
          next["parts"] = null;
        }
      }
      if (typeof next["metadata"] === "string") {
        try {
          next["metadata"] = JSON.parse(String(next["metadata"]));
        } catch {
          next["metadata"] = null;
        }
      }
      return next;
    });

    return { ...session, agent_state: agentState, messages: hydrated };
  }

  /**
   * Create a new chat session.
   * @param sessionId - Session identifier.
   * @param title - Session title.
   * @param model - Model name.
   * @param parentId - Parent session id.
   * @returns Created session.
   */
  public createSession(
    sessionId: string,
    title = "New Chat",
    model?: string,
    parentId?: string,
    agentState?: unknown,
  ): Record<string, unknown> {
    const agentStateJson = agentState !== undefined && agentState !== null
      ? JSON.stringify(agentState)
      : null;
    this.db
      .query("INSERT INTO chat_sessions (id, title, model, parent_id, agent_state) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, title, model ?? null, parentId ?? null, agentStateJson);
    const row = this.db
      .query("SELECT id, title, model, parent_id, agent_state, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown>;
    if (typeof row["agent_state"] === "string") {
      try {
        row["agent_state"] = JSON.parse(String(row["agent_state"]));
      } catch {
        row["agent_state"] = null;
      }
    }
    return { ...row };
  }

  /**
   * Update session title or model.
   * @param sessionId - Session identifier.
   * @param title - New title.
   * @param model - New model.
   * @returns True if updated.
   */
  public updateSession(
    sessionId: string,
    title?: string,
    model?: string,
    agentState?: unknown,
  ): boolean {
    const updates: string[] = [];
    const params: Array<string | null> = [];
    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (model !== undefined) {
      updates.push("model = ?");
      params.push(model);
    }
    if (agentState !== undefined) {
      updates.push("agent_state = ?");
      params.push(agentState === null ? null : JSON.stringify(agentState));
    }
    if (updates.length === 0) {
      return true;
    }
    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(sessionId);
    const result = this.db
      .query(`UPDATE chat_sessions SET ${updates.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  /**
   * Delete a chat session and its messages.
   * @param sessionId - Session identifier.
   * @returns True if deleted.
   */
  public deleteSession(sessionId: string): boolean {
    this.db.query("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
    const result = this.db.query("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    return result.changes > 0;
  }

  /**
   * Add a message to a session.
   * @param sessionId - Session identifier.
   * @param messageId - Message identifier.
   * @param role - Message role.
   * @param content - Message content.
   * @param model - Model name.
   * @param toolCalls - Tool call array.
   * @param promptTokens - Prompt token count.
   * @param toolsTokens - Tools token count.
   * @param totalInputTokens - Total input tokens.
   * @param completionTokens - Completion tokens.
   * @returns Stored message.
   */
  public addMessage(
    sessionId: string,
    messageId: string,
    role: string,
    content?: string,
    model?: string,
    toolCalls?: unknown[],
    promptTokens?: number,
    toolsTokens?: number,
    totalInputTokens?: number,
    completionTokens?: number,
    parts?: unknown[],
    metadata?: unknown,
  ): Record<string, unknown> {
    const toolCallsJson = toolCalls ? JSON.stringify(toolCalls) : null;
    const partsJson = parts ? JSON.stringify(parts) : null;
    const metadataJson = metadata !== undefined && metadata !== null ? JSON.stringify(metadata) : null;
    this.db.query(
      `INSERT INTO chat_messages
      (id, session_id, role, content, model, tool_calls, parts, metadata, request_prompt_tokens, request_tools_tokens,
       request_total_input_tokens, request_completion_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        tool_calls = excluded.tool_calls,
        parts = excluded.parts,
        metadata = excluded.metadata,
        request_prompt_tokens = excluded.request_prompt_tokens,
        request_tools_tokens = excluded.request_tools_tokens,
        request_total_input_tokens = excluded.request_total_input_tokens,
        request_completion_tokens = excluded.request_completion_tokens`
    ).run(
      messageId,
      sessionId,
      role,
      content ?? null,
      model ?? null,
      toolCallsJson,
      partsJson,
      metadataJson,
      promptTokens ?? null,
      toolsTokens ?? null,
      totalInputTokens ?? null,
      completionTokens ?? null,
    );
    this.db.query("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    const row = this.db
      .query(
        `SELECT id, role, content, model, tool_calls, parts, metadata, request_prompt_tokens, request_tools_tokens,
         request_total_input_tokens, request_completion_tokens, created_at
         FROM chat_messages WHERE id = ?`,
      )
      .get(messageId) as Record<string, unknown>;
    if (typeof row["tool_calls"] === "string") {
      try {
        row["tool_calls"] = JSON.parse(String(row["tool_calls"]));
      } catch {
        row["tool_calls"] = null;
      }
    }
    if (typeof row["parts"] === "string") {
      try {
        row["parts"] = JSON.parse(String(row["parts"]));
      } catch {
        row["parts"] = null;
      }
    }
    if (typeof row["metadata"] === "string") {
      try {
        row["metadata"] = JSON.parse(String(row["metadata"]));
      } catch {
        row["metadata"] = null;
      }
    }
    return row;
  }

  /**
   * Get usage totals for a session.
   * @param sessionId - Session identifier.
   * @returns Usage stats.
   */
  public getUsage(sessionId: string): Record<string, number> {
    const rows = this.db
      .query(
        "SELECT request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens FROM chat_messages WHERE session_id = ?",
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    let prompt = 0;
    let completion = 0;
    for (const row of rows) {
      const totalInput = Number(row["request_total_input_tokens"] ?? 0);
      const promptTokens = Number(row["request_prompt_tokens"] ?? 0);
      const completionTokens = Number(row["request_completion_tokens"] ?? 0);
      prompt += totalInput > 0 ? totalInput : promptTokens;
      completion += completionTokens;
    }
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  }

  /**
   * Fork an existing session.
   * @param sessionId - Original session id.
   * @param newId - New session id.
   * @param messageId - Optional message id to stop copying.
   * @param model - New model.
   * @param title - New title.
   * @returns Forked session or null.
   */
  public forkSession(
    sessionId: string,
    newId: string,
    messageId?: string,
    model?: string,
    title?: string,
  ): Record<string, unknown> | null {
    const toNullableString = (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      return String(value);
    };

    const toNullableNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) {
        return null;
      }
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const original = this.getSession(sessionId);
    if (!original) {
      return null;
    }
    const newTitle = title ?? `${String(original["title"])} (fork)`;
    const newModel = model ?? (original["model"] ? String(original["model"]) : undefined);
    const agentState = original["agent_state"] ?? null;
    const agentStateJson = agentState != null ? JSON.stringify(agentState) : null;

    this.db.query("INSERT INTO chat_sessions (id, title, model, parent_id, agent_state) VALUES (?, ?, ?, ?, ?)")
      .run(newId, newTitle, newModel ?? null, sessionId, agentStateJson);

    const messages = (original["messages"] ?? []) as Array<Record<string, unknown>>;
    for (const message of messages) {
      const toolCallsJson = message["tool_calls"] ? JSON.stringify(message["tool_calls"]) : null;
      const partsJson = message["parts"] ? JSON.stringify(message["parts"]) : null;
      const metadataJson = message["metadata"] ? JSON.stringify(message["metadata"]) : null;
      const newMessageId = `${newId}_${String(message["id"])}`;
      const role = String(message["role"] ?? "");
      const content = toNullableString(message["content"]);
      const messageModel = toNullableString(message["model"]);
      const promptTokens = toNullableNumber(message["request_prompt_tokens"]);
      const toolTokens = toNullableNumber(message["request_tools_tokens"]);
      const totalTokens = toNullableNumber(message["request_total_input_tokens"]);
      const completionTokens = toNullableNumber(message["request_completion_tokens"]);
      this.db.query(
        `INSERT INTO chat_messages
        (id, session_id, role, content, model, tool_calls, parts, metadata, request_prompt_tokens, request_tools_tokens,
         request_total_input_tokens, request_completion_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newMessageId,
        newId,
        role,
        content,
        messageModel,
        toolCallsJson,
        partsJson,
        metadataJson,
        promptTokens,
        toolTokens,
        totalTokens,
        completionTokens,
      );
      if (messageId && message["id"] === messageId) {
        break;
      }
    }

    const row = this.db
      .query("SELECT id, title, model, parent_id, agent_state, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(newId) as Record<string, unknown>;
    if (typeof row["agent_state"] === "string") {
      try {
        row["agent_state"] = JSON.parse(String(row["agent_state"]));
      } catch {
        row["agent_state"] = null;
      }
    }
    return { ...row };
  }
}
