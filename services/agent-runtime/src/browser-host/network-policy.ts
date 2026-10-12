// The browsing policy the embedded Chromium is held to on EVERY request, not
// just the first navigation.
//
// `sanitizeBrowserPaneUrl` vets the URL the model or panel asked for, but a
// page is free to redirect, load subresources, or open sockets to hosts that
// check never saw — and a hostname that resolved public at check time can
// re-resolve into a private range a moment later (DNS rebinding). This module
// closes both gaps with one rule set:
//
//   * `checkBrowserUrl` re-applies the SAME shared sanitizers the navigate
//     verb uses (public web + loopback for the pane; other private ranges
//     blocked) to any URL, including ws(s) upgrades and CONNECT targets.
//   * `resolvePinnedDestination` resolves the hostname itself and classifies
//     every answer with the same `classifyBrowserHost` rules; the caller then
//     connects to one of the addresses that was actually vetted, so the
//     answer cannot be swapped between check and connect.
//
// The pinning proxy (pinning-proxy.ts) is the enforcement point that funnels
// all of Chromium's traffic through these two functions.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  classifyBrowserHost,
  sanitizeBrowserPaneUrl,
  sanitizePublicBrowserUrl,
} from "../../../../shared/agent/sanitize-embedded-browser-url";

/**
 * "pane" is the embedded browser's rule set: public web plus loopback, because
 * previewing local dev servers is the pane's main job. "public" is the
 * stricter reading-mode rule set with no loopback allowance.
 */
export type BrowserNetworkMode = "public" | "pane";

export type PinnedAddress = { address: string; family: 4 | 6 };

export type PinnedDestination = {
  /** The vetted URL, normalized. */
  url: string;
  /** Original hostname, for the Host header / SNI. */
  host: string;
  port: number;
  /**
   * Every resolved address that passed classification, in resolver order.
   * Connect to these and nothing else — dial fallback across the list is fine
   * (all of them were vetted), re-resolution is not.
   */
  addresses: PinnedAddress[];
};

const RESOLVE_TIMEOUT_MS = 5_000;

/**
 * The pane's private-network allowance. The desktop shell sets this: a
 * single-user machine previewing its own LAN and tailnet is the embedded
 * browser's day job, and Tailscale peers live in CGNAT space that the base
 * policy rightly refuses on shared deployments. Read per call — it is one env
 * lookup, and the browsing policy should follow the process env, not a
 * snapshot taken before the desktop shell finished wiring it.
 */
function allowPrivateBrowsing(): boolean {
  return process.env.LOCAL_STUDIO_BROWSER_ALLOW_PRIVATE === "1";
}

/**
 * Vet a URL against the browsing policy without touching the network. Accepts
 * http(s) and ws(s) (websockets are policed by the same host rules). Returns
 * the normalized URL, or null when the policy rejects it.
 */
export function checkBrowserUrl(raw: string, mode: BrowserNetworkMode): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^(?:http|ws)s?:$/.test(url.protocol)) return null;
  // Embedded credentials never belong in agent-driven requests.
  if (url.username || url.password) return null;
  const probe = new URL(url.toString());
  probe.protocol = url.protocol.replace(/^ws/, "http");
  const sanitized =
    mode === "pane"
      ? sanitizeBrowserPaneUrl(probe.toString(), { allowPrivate: allowPrivateBrowsing() })
      : sanitizePublicBrowserUrl(probe.toString());
  return sanitized ? url.toString() : null;
}

function expectedHostClass(
  hostname: string,
  mode: BrowserNetworkMode,
): "public" | "loopback" | "private" {
  const hostClass = classifyBrowserHost(hostname);
  if (hostClass === "blocked") throw new Error(`Browser policy blocked host: ${hostname}`);
  if (hostClass === "private" && !(mode === "pane" && allowPrivateBrowsing())) {
    throw new Error(`Browser policy blocked private host: ${hostname}`);
  }
  if (hostClass === "loopback" && mode !== "pane") {
    throw new Error(`Browser policy blocked loopback host: ${hostname}`);
  }
  return hostClass;
}

async function resolveWithTimeout(hostname: string): Promise<PinnedAddress[]> {
  const resolved = lookup(hostname, { all: true, verbatim: true });
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Browser policy DNS resolution timed out for ${hostname}`)),
      RESOLVE_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  const answers = await Promise.race([resolved, timeout]);
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
}

/**
 * Vet a URL, resolve its hostname, and classify every resolved address with
 * the same rules that vetted the URL. Throws when the URL, the resolution, or
 * any resolved address violates the policy. A hostname that looked public must
 * resolve to public addresses only; a loopback spelling must stay on loopback.
 */
export async function resolvePinnedDestination(
  raw: string,
  mode: BrowserNetworkMode,
): Promise<PinnedDestination> {
  const vetted = checkBrowserUrl(raw, mode);
  if (!vetted) throw new Error(`Browser policy blocked URL: ${raw}`);
  const url = new URL(vetted);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const expected = expectedHostClass(hostname, mode);

  const literalFamily = isIP(hostname);
  const answers: PinnedAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }]
    : await resolveWithTimeout(hostname);
  if (answers.length === 0) throw new Error(`Host resolved to no addresses: ${hostname}`);
  // A loopback spelling must stay on loopback, always. For everything else,
  // the private allowance also has to accept public names that RESOLVE private
  // — a tailnet MagicDNS name is a public hostname answering with a CGNAT
  // address, which is the exact shape the strict policy exists to refuse and
  // the exact shape the allowance exists to permit.
  const allowedClasses: string[] =
    expected === "loopback"
      ? ["loopback"]
      : mode === "pane" && allowPrivateBrowsing()
        ? ["public", "private"]
        : [expected];
  for (const answer of answers) {
    // Zone-scoped addresses (fe80::1%en0) never pass; the '%' would also
    // confuse the classifier, so reject them outright.
    if (answer.address.includes("%") || !allowedClasses.includes(classifyBrowserHost(answer.address))) {
      throw new Error(
        `Browser policy blocked resolved address for ${hostname}: ${answer.address}`,
      );
    }
  }

  // Loopback dev servers overwhelmingly bind IPv4; when the resolver orders
  // ::1 first, putting 127.0.0.1 ahead saves the dial fallback round.
  const ordered =
    expected === "loopback"
      ? [...answers].sort((a, b) => a.family - b.family)
      : answers;

  const port = url.port
    ? Number(url.port)
    : /^(?:https|wss):$/.test(url.protocol)
      ? 443
      : 80;
  return { url: url.toString(), host: url.host, port, addresses: ordered };
}
