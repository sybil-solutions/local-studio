import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { resolveDataDir } from "./data-dir";

type VaultResponse = {
  channel: "local-studio:oauth-vault:response";
  id: string;
  ok: boolean;
  value?: string;
  error?: string;
};

type PendingRequest = {
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export interface OAuthVault {
  read(key: string): Effect.Effect<string | undefined, OAuthVaultError>;
  write(key: string, value: string): Effect.Effect<void, OAuthVaultError>;
  remove(key: string): Effect.Effect<void, OAuthVaultError>;
}

export class OAuthVaultError extends Error {}

const pending = new Map<string, PendingRequest>();
let listening = false;

function isVaultResponse(value: unknown): value is VaultResponse {
  if (!value || typeof value !== "object") return false;
  const channel = Reflect.get(value, "channel");
  const id = Reflect.get(value, "id");
  const ok = Reflect.get(value, "ok");
  const responseValue = Reflect.get(value, "value");
  const error = Reflect.get(value, "error");
  return (
    channel === "local-studio:oauth-vault:response" &&
    typeof id === "string" &&
    typeof ok === "boolean" &&
    (responseValue === undefined || typeof responseValue === "string") &&
    (error === undefined || typeof error === "string")
  );
}

function listen(): void {
  if (listening) return;
  listening = true;
  process.on("message", (message: unknown) => {
    if (!isVaultResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.ok) request.resolve(message.value);
    else request.reject(new OAuthVaultError(message.error ?? "Secure OAuth storage failed"));
  });
}

function request(
  operation: "read" | "write" | "delete",
  key: string,
  value?: string,
): Promise<string | undefined> {
  listen();
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(new OAuthVaultError("Secure OAuth storage requires the desktop app"));
      return;
    }
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new OAuthVaultError("Secure OAuth storage timed out"));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    process.send(
      {
        channel: "local-studio:oauth-vault:request",
        id,
        operation,
        key,
        ...(value === undefined ? {} : { value }),
      },
      undefined,
      undefined,
      (error: Error | null) => {
        if (!error) return;
        const active = pending.get(id);
        if (!active) return;
        pending.delete(id);
        clearTimeout(active.timeout);
        active.reject(new OAuthVaultError("Secure OAuth storage request failed"));
      },
    );
  });
}

function vaultEffect<A>(operation: () => Promise<A>): Effect.Effect<A, OAuthVaultError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof OAuthVaultError ? error : new OAuthVaultError("Secure OAuth storage failed"),
  });
}

export const desktopOAuthVault: OAuthVault = {
  read: (key) => vaultEffect(() => request("read", key)),
  write: (key, value) => vaultEffect(async () => void (await request("write", key, value))),
  remove: (key) => vaultEffect(async () => void (await request("delete", key))),
};

/**
 * Headless runtimes (a server install, `npm run start`) have no Electron parent
 * to encrypt with, so secrets fall back to an owner-only file in the data dir.
 * It is deliberately not the desktop's `oauth-vault.json`: that file holds
 * safeStorage ciphertext this process could not read anyway.
 */
const fileVaultKeyPattern = /^[a-z0-9][a-z0-9:_-]{0,127}$/;
let fileVaultAccess: Promise<unknown> = Promise.resolve();

export function resolveFileOAuthVaultPath(): string {
  return path.join(resolveDataDir(), "oauth-vault.local.json");
}

async function readFileVault(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OAuthVaultError("OAuth vault is invalid");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        fileVaultKeyPattern.test(entry[0]) && typeof entry[1] === "string",
    ),
  );
}

function fileVaultOperation(
  operation: "read" | "write" | "delete",
  key: string,
  value?: string,
): Promise<string | undefined> {
  const run = fileVaultAccess.then(async () => {
    if (!fileVaultKeyPattern.test(key)) throw new OAuthVaultError("OAuth vault key is invalid");
    const file = resolveFileOAuthVaultPath();
    const vault = await readFileVault(file);
    if (operation === "read") return vault[key];
    if (operation === "write") vault[key] = value ?? "";
    else delete vault[key];
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
    return undefined;
  });
  fileVaultAccess = run.catch(() => undefined);
  return run;
}

export const fileOAuthVault: OAuthVault = {
  read: (key) => vaultEffect(() => fileVaultOperation("read", key)),
  write: (key, value) => vaultEffect(async () => void (await fileVaultOperation("write", key, value))),
  remove: (key) => vaultEffect(async () => void (await fileVaultOperation("delete", key))),
};

/** The desktop app's encrypted vault when this runtime is its child, the file otherwise. */
function activeOAuthVault(): OAuthVault {
  return process.send && process.connected ? desktopOAuthVault : fileOAuthVault;
}

export const defaultOAuthVault: OAuthVault = {
  read: (key) => activeOAuthVault().read(key),
  write: (key, value) => activeOAuthVault().write(key, value),
  remove: (key) => activeOAuthVault().remove(key),
};
