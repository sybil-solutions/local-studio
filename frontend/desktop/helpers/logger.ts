import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "desktop.log");
const LOG_BACKUP_FILE = path.join(LOG_DIR, "desktop.log.1");
const MAX_LOG_BYTES = 20 * 1024 * 1024;

function rotateLogIfNeeded(): void {
  try {
    if (statSync(LOG_FILE).size < MAX_LOG_BYTES) return;
    rmSync(LOG_BACKUP_FILE, { force: true });
    renameSync(LOG_FILE, LOG_BACKUP_FILE);
  } catch {
    // Missing or locked log files should not take the app down.
  }
}

function write(level: "INFO" | "WARN" | "ERROR", message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line, { encoding: "utf8" });
  } catch {
    // Fall back to stdout only.
  }

  if (level === "ERROR") {
    console.error(`[desktop] ${message}`);
  } else if (level === "WARN") {
    console.warn(`[desktop] ${message}`);
  } else {
    console.log(`[desktop] ${message}`);
  }
}

export const log = {
  info(message: string): void {
    write("INFO", message);
  },
  warn(message: string): void {
    write("WARN", message);
  },
  error(message: string): void {
    write("ERROR", message);
  },
};
