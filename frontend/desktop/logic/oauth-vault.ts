import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

type VaultRequest = {
  channel: "local-studio:oauth-vault:request";
  id: string;
  operation: "read" | "write" | "delete";
  key: string;
  value?: string;
};

const keyPattern = /^[a-z0-9][a-z0-9:_-]{0,127}$/;
let vaultAccess = Promise.resolve();

function isVaultRequest(value: unknown): value is VaultRequest {
  if (!value || typeof value !== "object") return false;
  const channel = Reflect.get(value, "channel");
  const id = Reflect.get(value, "id");
  const operation = Reflect.get(value, "operation");
  const key = Reflect.get(value, "key");
  const requestValue = Reflect.get(value, "value");
  return (
    channel === "local-studio:oauth-vault:request" &&
    typeof id === "string" &&
    typeof operation === "string" &&
    ["read", "write", "delete"].includes(operation) &&
    typeof key === "string" &&
    keyPattern.test(key) &&
    (requestValue === undefined ||
      (typeof requestValue === "string" && requestValue.length <= 1_000_000))
  );
}

async function readVault(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OAuth vault is invalid");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        keyPattern.test(entry[0]) && typeof entry[1] === "string",
    ),
  );
}

async function writeVault(file: string, vault: Record<string, string>): Promise<void> {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

function vaultOperation(file: string, request: VaultRequest): Promise<string | undefined> {
  const operation = vaultAccess.then(async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable");
    const vault = await readVault(file);
    if (request.operation === "read") {
      const encrypted = vault[request.key];
      if (!encrypted) return undefined;
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      if (decrypted.length > 1_000_000) throw new Error("OAuth vault value is too large");
      return decrypted;
    }
    if (request.operation === "write") {
      if (request.value === undefined) throw new Error("Vault value is required");
      vault[request.key] = safeStorage.encryptString(request.value).toString("base64");
    } else {
      delete vault[request.key];
    }
    await writeVault(file, vault);
    return undefined;
  });
  vaultAccess = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function registerOAuthVault(child: ChildProcess, dataDir: string): void {
  const file = path.join(dataDir, "oauth-vault.json");
  child.on("message", (message: unknown) => {
    if (!isVaultRequest(message)) return;
    void vaultOperation(file, message)
      .then((value) => {
        if (child.connected) {
          child.send({
            channel: "local-studio:oauth-vault:response",
            id: message.id,
            ok: true,
            ...(value === undefined ? {} : { value }),
          });
        }
      })
      .catch(() => {
        if (child.connected) {
          child.send({
            channel: "local-studio:oauth-vault:response",
            id: message.id,
            ok: false,
            error: "Secure OAuth storage failed",
          });
        }
      });
  });
}
