import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await copyFile(
  path.resolve(frontendRoot, "../services/agent-runtime/src/executable-identity.cjs"),
  path.join(frontendRoot, "desktop/dist/executable-identity.cjs"),
);
