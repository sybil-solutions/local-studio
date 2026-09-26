import { existsSync } from "node:fs";
import type { TailnetCandidate } from "@local-studio/contracts";
import { SERVICE } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { which } from "../core/exec";

interface TsNode {
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
const PROBE_PORT = 8080;
const CONCURRENCY = 8;

const tailscaleBin = async (): Promise<string | null> => {
  const found = await which("tailscale", ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]);
  if (found) return found;
  return existsSync(MAC_APP_CLI) ? MAC_APP_CLI : null;
};

const pool = async <T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
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
  const candidates = await pool(nodes, CONCURRENCY, async (p): Promise<TailnetCandidate> => {
    const dnsName = (p.DNSName ?? "").replace(/\.$/, "");
    const url = `http://${dnsName}:${PROBE_PORT}`;
    let kind: TailnetCandidate["kind"] = "none";
    let machineId: string | null = null;
    try {
      const res = await ctx.fetch(`${url}/health`, { method: "GET", timeoutMs: 2000 });
      const text = await res.text();
      if (res.ok) {
        const body = JSON.parse(text) as { status?: string; service?: string; machineId?: string };
        if (body.service === SERVICE && body.machineId) {
          kind = "local-studio";
          machineId = body.machineId;
        } else if (body.status === "ok") kind = "legacy-controller";
      }
    } catch {}
    return {
      dnsName,
      hostName: p.HostName ?? dnsName.split(".")[0] ?? dnsName,
      os: p.OS ?? "",
      url,
      kind,
      machineId,
      alreadyConnected: (machineId !== null && known.machineIds.has(machineId)) || known.hosts.has(dnsName.toLowerCase()),
    };
  });
  return { candidates, error: null };
};
