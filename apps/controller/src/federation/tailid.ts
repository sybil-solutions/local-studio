import type { Ctx } from "../context";
import { tailscaleBin } from "./tailnet";

export interface TailnetSelf {
  login: string;
  userId: number | null;
  tailnet: string | null;
  ip: string | null;
}

const TTL_MS = 60_000;
const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;
const TS_V6 = /^fd7a:115c:a1e0:/i;

export const isTailnetIp = (ip: string): boolean => {
  const v = ip.replace(/^::ffff:/, "");
  return CGNAT.test(v) || TS_V6.test(v);
};

export interface TailId {
  self(): Promise<TailnetSelf | null>;
  owns(ip: string): Promise<boolean>;
  trust: boolean;
}

export const createTailId = (ctx: Ctx): TailId => {
  const trust = (process.env.LOCAL_STUDIO_TAILNET_TRUST ?? "owner").toLowerCase() !== "off";
  let selfAt = 0;
  let selfVal: TailnetSelf | null = null;
  let selfP: Promise<TailnetSelf | null> | null = null;
  const seen = new Map<string, { at: number; ok: boolean; p?: Promise<boolean> }>();

  const run = async (args: string[]): Promise<unknown> => {
    const bin = await tailscaleBin();
    if (!bin) return null;
    const r = await ctx.exec([bin, ...args], { timeoutMs: 4000 });
    if (r.code !== 0 || r.timedOut) return null;
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  };

  const self = async (): Promise<TailnetSelf | null> => {
    if (Date.now() - selfAt < TTL_MS) return selfVal;
    selfP ??= (async () => {
      const s = (await run(["status", "--json"])) as {
        Self?: { UserID?: number; TailscaleIPs?: string[] };
        User?: Record<string, { LoginName?: string }>;
        CurrentTailnet?: { Name?: string } | null;
      } | null;
      const uid = s?.Self?.UserID ?? null;
      const login = uid !== null ? s?.User?.[String(uid)]?.LoginName : undefined;
      selfVal = login ? { login, userId: uid, tailnet: s?.CurrentTailnet?.Name ?? null, ip: s?.Self?.TailscaleIPs?.find((x) => x.includes(".")) ?? null } : null;
      selfAt = Date.now();
      selfP = null;
      return selfVal;
    })();
    return selfP;
  };

  const owns = async (ip: string): Promise<boolean> => {
    const addr = ip.replace(/^::ffff:/, "");
    if (!trust || !isTailnetIp(addr)) return false;
    const hit = seen.get(addr);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p ?? hit.ok;
    const p = (async () => {
      const me = await self();
      if (!me) return false;
      const w = (await run(["whois", "--json", addr])) as { Node?: { Tags?: string[] | null }; UserProfile?: { LoginName?: string } } | null;
      const ok = !!w && !(w.Node?.Tags && w.Node.Tags.length > 0) && w.UserProfile?.LoginName === me.login;
      seen.set(addr, { at: Date.now(), ok });
      if (!ok && w) ctx.log.info(`tailnet ${addr}: ${w.UserProfile?.LoginName ?? "unknown"} is not ${me.login}; not trusted`);
      return ok;
    })();
    seen.set(addr, { at: Date.now(), ok: false, p });
    return p;
  };

  return { self, owns, trust };
};
