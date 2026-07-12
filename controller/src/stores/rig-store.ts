import type { Rig } from "@local-studio/contracts/rigs";
import { JsonBlobStore } from "./json-blob-store";

function decodeRig(data: string): Rig | null {
  try {
    return JSON.parse(data) as Rig;
  } catch {
    return null;
  }
}

export class RigStore extends JsonBlobStore<Rig> {
  public constructor(dbPath: string) {
    super(dbPath, "rigs", { orderBy: "created_at", idOf: (rig) => rig.id, decode: decodeRig });
  }
}
