import { existsSync } from "node:fs";
import type { TailnetCandidate } from "@local-studio/contracts";
import { SERVICE } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { which } from "../core/exec";
import { pool } from "../discovery/util";

interface TsNode {
  UserID?: number;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  Tags?: string[] | null;
}

interface TsStatus {
  MagicDNSSuffix?: string;
  CurrentTailnet?: { MagicDNSSuffix?: string } | null;
  Self?: TsNode;
  Peer?: Record<string, TsNode> | null;
}

const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const PORTS = (process.env.LOCAL_STUDIO_TAILNET_PORTS ?? "8080,18090")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isInteger(x) && x > 0 && x < 65536);
const CONCURRENCY = 8;

export const tailscaleBin = async (): Promise<string | null> => {
  const found = await which("tailscale", ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]);
  if (found) return found;
  return existsSync(MAC_APP_CLI) ? MAC_APP_CLI : null;
};

export const discoverTailnet = async (
  ctx: Ctx,
  known: { machineIds: Set<string>; hosts: Set<string> },
): Promise<{ candidates: TailnetCandidate[]; error: string | null }> => {
  const bin = await tailscaleBin();
  if (!bin) return { candidates: [], error: "tailscale CLI not found" };
  const r = await ctx.exec([bin, "status", "--json"], { timeoutMs: 5000 });
  if (r.timedOut) return { candidates: [], error: "tailscale status timed out after 5 s" };
  if (r.code !== 0) return { candidates: [], error: `tailscale status failed: ${r.stderr.trim().slice(0, 200)}` };
  let status: TsStatus;
  try {
    status = JSON.parse(r.stdout) as TsStatus;
  } catch {
    return { candidates: [], error: "tailscale status returned invalid JSON" };
  }
  const suffix = (status.CurrentTailnet?.MagicDNSSuffix ?? status.MagicDNSSuffix ?? "").replace(/\.$/, "");
  const nodes = Object.values(status.Peer ?? {}).filter(
    (p) =>
      p.Online === true &&
      !(p.Tags && p.Tags.length > 0) &&
      !!p.DNSName &&
      (!suffix || p.DNSName.replace(/\.$/, "").endsWith(`.${suffix}`)) &&
      (p.OS === "linux" || p.OS === "macOS"),
  );
  const me = status.Self?.UserID;
  const candidates = await pool(nodes, CONCURRENCY, async (p): Promise<TailnetCandidate> => {
    const dnsName = (p.DNSName ?? "").replace(/\.$/, "");
    let found: { url: string; kind: TailnetCandidate["kind"]; machineId: string | null } | null = null;
    for (const port of PORTS) {
      const url = `http://${dnsName}:${port}`;
      try {
        const res = await ctx.fetch(`${url}/health`, { method: "GET", timeoutMs: 2000 });
        const text = await res.text();
        if (!res.ok) continue;
        const body = JSON.parse(text) as { status?: string; service?: string; machineId?: string };
        if (body.service === SERVICE && body.machineId) {
          found = { url, kind: "local-studio", machineId: body.machineId };
          break;
        }
        if (body.status === "ok" && !found) found = { url, kind: "legacy-controller", machineId: null };
      } catch {}
    }
    const machineId = found?.machineId ?? null;
    return {
      dnsName,
      hostName: p.HostName ?? dnsName.split(".")[0] ?? dnsName,
      os: p.OS ?? "",
      url: found?.url ?? `http://${dnsName}:${PORTS[0] ?? 8080}`,
      kind: found?.kind ?? "none",
      machineId,
      alreadyConnected: (machineId !== null && known.machineIds.has(machineId)) || known.hosts.has(dnsName.toLowerCase()),
      mine: me !== undefined && p.UserID === me,
    };
  });
  return { candidates, error: null };
};
