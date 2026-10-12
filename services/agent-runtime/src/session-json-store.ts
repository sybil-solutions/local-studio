import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "./data-dir";

// Serialize read-modify-write cycles per file so concurrent POSTs (e.g. an
// agent plan autosave overlapping a user edit) can't both read v1 and drop one
// update. Promise-chain per path; entries are removed when the chain drains.
const writeChains = new Map<string, Promise<unknown>>();

function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(file) ?? Promise.resolve();
  const run = previous.then(task, task);
  const guarded = run.finally(() => {
    if (writeChains.get(file) === guarded) writeChains.delete(file);
  });
  writeChains.set(file, guarded);
  return run;
}

function sanitizeSessionId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

export function createSessionScopedJsonStore<T extends { updatedAt: string }>(config: {
  subdir: string;
  legacyFile: string;
  normalize: (input: unknown) => T;
}) {
  const filePath = (sessionId: string | null | undefined): string => {
    const id = sanitizeSessionId(sessionId);
    return id
      ? path.join(resolveDataDir(), config.subdir, `${id}.json`)
      : path.join(resolveDataDir(), config.legacyFile);
  };

  const read = async (sessionId?: string | null): Promise<T> => {
    try {
      return config.normalize(JSON.parse(await readFile(filePath(sessionId), "utf8")));
    } catch {
      return config.normalize(undefined);
    }
  };

  const write = (patch: Partial<Omit<T, "updatedAt">>, sessionId?: string | null): Promise<T> => {
    const file = filePath(sessionId);
    return withFileLock(file, async () => {
      const current = await read(sessionId);
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      const next = config.normalize({
        ...current,
        ...defined,
        updatedAt: new Date().toISOString(),
      });
      await mkdir(path.dirname(file), { recursive: true });
      // Write-then-rename so a crash mid-write can't truncate the document
      // (read() swallows parse errors and would silently return an empty doc).
      const tempFile = `${file}.tmp-${process.pid}`;
      await writeFile(tempFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(tempFile, file);
      return next;
    });
  };

  return { read, write };
}
