import { hostname } from "node:os";
import { join } from "node:path";
import type { Health } from "@local-studio/contracts";
import { API_VERSION, SERVICE } from "@local-studio/contracts";
import type { Config } from "./config";
import { readOrCreateSecretFile } from "./config";

export interface Identity {
  machineId: string;
  name: string;
  hostname: string;
  health(): Health;
}

export const loadIdentity = (config: Config): Identity => {
  const machineId = readOrCreateSecretFile(join(config.dataDir, "machine-id"), () => crypto.randomUUID());
  return {
    machineId,
    name: config.name,
    hostname: hostname(),
    health: () => ({
      status: "ok",
      service: SERVICE,
      version: config.version,
      machineId,
      name: config.name,
      api: API_VERSION,
      readOnly: config.readOnly,
    }),
  };
};
