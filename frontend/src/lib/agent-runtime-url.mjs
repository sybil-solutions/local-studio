export const AGENT_RUNTIME_URL_ERROR = "Agent runtime URL configuration is invalid.";
export const DEFAULT_AGENT_RUNTIME_URL = "http://127.0.0.1:8081";

const supportedProtocols = new Set(["http:", "https:"]);

export const resolveAgentRuntimeUrl = (value) => {
  const candidate =
    typeof value === "string" && value.trim() ? value.trim() : DEFAULT_AGENT_RUNTIME_URL;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: AGENT_RUNTIME_URL_ERROR };
  }
  if (
    !supportedProtocols.has(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    return { ok: false, error: AGENT_RUNTIME_URL_ERROR };
  }
  return {
    ok: true,
    url: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port,
  };
};
