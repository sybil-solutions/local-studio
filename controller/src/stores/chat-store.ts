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
        request_prompt_tokens INTEGER,
        request_tools_tokens INTEGER,
        request_total_input_tokens INTEGER,
        request_completion_tokens INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id)");
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
      .query("SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | null;
    if (!session) {
      return null;
    }

    const messages = this.db
      .query(`SELECT id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens,
              request_total_input_tokens, request_completion_tokens, created_at
              FROM chat_messages WHERE session_id = ? ORDER BY created_at`)
      .all(sessionId) as Array<Record<string, unknown>>;

    const hydrated = messages.map((message) => {
      if (typeof message["tool_calls"] === "string") {
        try {
          return { ...message, tool_calls: JSON.parse(String(message["tool_calls"])) };
        } catch {
          return { ...message, tool_calls: null };
        }
      }
      return message;
    });

    return { ...session, messages: hydrated };
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
  ): Record<string, unknown> {
    this.db
      .query("INSERT INTO chat_sessions (id, title, model, parent_id) VALUES (?, ?, ?, ?)")
      .run(sessionId, title, model ?? null, parentId ?? null);
    const row = this.db
      .query("SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown>;
    return { ...row };
  }

  /**
   * Update session title or model.
   * @param sessionId - Session identifier.
   * @param title - New title.
   * @param model - New model.
   * @returns True if updated.
   */
  public updateSession(sessionId: string, title?: string, model?: string): boolean {
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
  ): Record<string, unknown> {
    const toolCallsJson = toolCalls ? JSON.stringify(toolCalls) : null;
    this.db.query(
      `INSERT INTO chat_messages
      (id, session_id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens,
       request_total_input_tokens, request_completion_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        tool_calls = excluded.tool_calls,
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
      promptTokens ?? null,
      toolsTokens ?? null,
      totalInputTokens ?? null,
      completionTokens ?? null,
    );
    this.db.query("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    const row = this.db
      .query(
        `SELECT id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens,
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

    this.db.query("INSERT INTO chat_sessions (id, title, model, parent_id) VALUES (?, ?, ?, ?)")
      .run(newId, newTitle, newModel ?? null, sessionId);

    const messages = (original["messages"] ?? []) as Array<Record<string, unknown>>;
    for (const message of messages) {
      const toolCallsJson = message["tool_calls"] ? JSON.stringify(message["tool_calls"]) : null;
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
        (id, session_id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens,
         request_total_input_tokens, request_completion_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newMessageId,
        newId,
        role,
        content,
        messageModel,
        toolCallsJson,
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
      .query("SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?")
      .get(newId) as Record<string, unknown>;
    return { ...row };
  }
}
