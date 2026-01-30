#!/usr/bin/env bun
/**
 * Script to retitle all existing chats based on first user message.
 * Run with: bun run scripts/retitle-chats.ts
 */
import { Database } from "bun:sqlite";
import path from "node:path";

/**
 * Generates a short title from user message content.
 * @param content - User message content.
 * @returns Generated title string.
 */
function generateTitleFromMessage(content: string): string {
  if (!content || !content.trim()) {
    return "New Chat";
  }

  const cleaned = content
    .replace(/\n/g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter((w) => w.length > 0);
  const titleWords = words.slice(0, 5);

  if (titleWords.length === 0) {
    return "New Chat";
  }

  const title = titleWords
    .map((w, index) => (index === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

  return title.length > 50 ? title.slice(0, 47) + "..." : title;
}

/**
 * Main script entry point for retitling chat sessions.
 */
async function main(): Promise<void> {
  const dataDirectory = process.env["VLLM_STUDIO_DATA_DIR"] || path.join(process.cwd(), "..", "data");
  const dbPath = path.join(dataDirectory, "chats.db");

  console.log(`Opening database: ${dbPath}`);

  const db = new Database(dbPath);

  // Get all sessions
  const sessions = db.query("SELECT id, title FROM chat_sessions").all() as Array<{
    id: string;
    title: string;
  }>;

  console.log(`Found ${sessions.length} chat sessions`);

  let updated = 0;
  let skipped = 0;

  for (const session of sessions) {
    // Get first user message for this session
    const firstUserMessage = db
      .query(
        "SELECT content FROM chat_messages WHERE session_id = ? AND role = 'user' ORDER BY created_at LIMIT 1"
      )
      .get(session.id) as { content: string } | null;

    if (!firstUserMessage || !firstUserMessage.content) {
      console.log(`  Skipping ${session.id}: no user messages`);
      skipped++;
      continue;
    }

    const newTitle = generateTitleFromMessage(firstUserMessage.content);
    const oldTitle = session.title;

    if (newTitle === oldTitle) {
      console.log(`  Skipping ${session.id}: title unchanged (${oldTitle})`);
      skipped++;
      continue;
    }

    db.query("UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      newTitle,
      session.id
    );

    console.log(`  Updated ${session.id}: "${oldTitle}" -> "${newTitle}"`);
    updated++;
  }

  db.close();

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}, Total: ${sessions.length}`);
}

main().catch(console.error);
