import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

const UI_PREFERENCES_KEY = "ui_preferences";

type SettingRow = {
  value: string;
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
};

/**
 * Durable controller-owned settings stored in the controller SQLite database.
 */
export class ControllerSettingsStore {
  private readonly db: Database;

  /**
   * @param dbPath - SQLite database path.
   */
  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.ensureSchema();
  }

  /**
   * Create controller settings storage.
   */
  private ensureSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS controller_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Load renderer UI preferences backed by the controller database.
   */
  public getUiPreferences(): Record<string, string> {
    const row = this.db
      .query("SELECT value FROM controller_settings WHERE key = ?")
      .get(UI_PREFERENCES_KEY) as SettingRow | null;
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return isStringRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Replace the stored renderer UI preference snapshot.
   * @param preferences - String-valued local UI preference map.
   */
  public saveUiPreferences(preferences: Record<string, string>): Record<string, string> {
    const clean = Object.fromEntries(
      Object.entries(preferences).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && entry[0].length > 0 && typeof entry[1] === "string"
      )
    );
    this.db
      .query(
        `INSERT INTO controller_settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .run(UI_PREFERENCES_KEY, JSON.stringify(clean));
    return clean;
  }
}
