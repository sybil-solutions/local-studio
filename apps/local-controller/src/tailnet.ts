import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalTailnet } from "../../../packages/contracts/src/localStudio.ts";
import { decodeJson, exec, fetchJson } from "./core.ts";
import { normUrl } from "./graph.ts";

const Peer = Schema.Struct({ HostName: Schema.String, Online: Schema.Boolean, TailscaleIPs: Schema.Array(Schema.String) });
const Status = Schema.Struct({ Peer: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Peer))) });
const decodeHealth = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String, name: Schema.String }));

export const scanTailnet = (linked: Set<string>): Effect.Effect<LocalTailnet> =>
  Effect.gen(function* () {
    let status: typeof Status.Type | undefined;
    for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
      if (status) break;
      const r = yield* exec([bin, "status", "--json"], 5_000);
      status = r.code === 0 ? decodeJson(Status, r.stdout) : undefined;
    }
    if (!status) return { available: false, devices: [] };
    const peers = Object.values(status.Peer ?? {}).filter((p) => p.Online && p.TailscaleIPs[0]);
    const devices = yield* Effect.forEach(
      peers,
      (p) =>
        Effect.gen(function* () {
          const ip = p.TailscaleIPs.find((a) => !a.includes(":")) ?? p.TailscaleIPs[0] ?? "";
          const url = `http://${ip}:18091`;
          const res = yield* Effect.option(fetchJson(`${url}/api/health`, 1_500));
          const health = res._tag === "Some" && res.value.status === 200 ? decodeHealth(res.value.body) : null;
          return { name: p.HostName, ip, controller: health?._tag === "Some" ? { ...health.value, url } : null, linked: linked.has(normUrl(url)) };
        }),
      { concurrency: 16 },
    );
    return { available: true, devices: devices.sort((a, b) => a.name.localeCompare(b.name)) };
  });
