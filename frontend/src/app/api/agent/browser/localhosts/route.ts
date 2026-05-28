import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 650;
const LSOF_TIMEOUT_MS = 2_500;
const MAX_CANDIDATES = 48;
const FALLBACK_PORTS = [3000, 3001, 3002, 3017, 4173, 5173, 5174, 8000, 8080, 8317, 1234];

type PortCandidate = {
  port: number;
  process?: string;
};

type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

function parseCurrentPort(request: NextRequest): number | null {
  const host = request.headers.get("host") ?? "";
  const match = host.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) ? port : null;
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  return title
    ? title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    : "";
}

function parseLsof(stdout: string): PortCandidate[] {
  const byPort = new Map<number, PortCandidate>();
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const listenMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!listenMatch) continue;
    const port = Number(listenMatch[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    const processName = line.trim().split(/\s+/)[0];
    if (!byPort.has(port)) byPort.set(port, { port, process: processName });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port).slice(0, MAX_CANDIDATES);
}

async function listListeningPorts(): Promise<PortCandidate[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const ports = parseLsof(stdout);
    if (ports.length > 0) return ports;
  } catch {
    // Fall through to common dev-server ports.
  }
  return FALLBACK_PORTS.map((port) => ({ port }));
}

async function probePort(
  candidate: PortCandidate,
  currentPort: number | null,
): Promise<LocalhostSite | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `http://127.0.0.1:${candidate.port}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let title = "";
    if (contentType.includes("text/html")) {
      title = titleFromHtml((await response.text()).slice(0, 64_000));
    }
    const displayUrl = `localhost:${candidate.port}`;
    return {
      port: candidate.port,
      url: `http://${displayUrl}`,
      displayUrl,
      title: title || displayUrl,
      process: candidate.process,
      current: candidate.port === currentPort,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const currentPort = parseCurrentPort(request);
  const candidates = await listListeningPorts();
  const probed = await Promise.all(
    candidates.map((candidate) => probePort(candidate, currentPort)),
  );
  const sites = probed
    .filter((site): site is LocalhostSite => Boolean(site))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.port - b.port;
    });
  return Response.json({ sites });
}
