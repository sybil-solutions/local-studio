import { Socket } from "node:net";

export interface TemporalStatus {
  address: string;
  available: boolean;
  latency_ms: number | null;
  error?: string;
}

const parseTemporalAddress = (address: string): { host: string; port: number } | null => {
  const trimmed = address.trim();
  if (!trimmed) {
    return null;
  }
  const withoutScheme = trimmed.replace(/^\w+:\/\//, "");
  const [host, portRaw] = withoutScheme.split(":");
  if (!host) {
    return null;
  }
  const port = Number(portRaw ?? "7233");
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }
  return { host, port };
};

export const checkTemporalStatus = async (address: string, timeoutMs = 1500): Promise<TemporalStatus> => {
  const parsed = parseTemporalAddress(address);
  if (!parsed) {
    return { address, available: false, latency_ms: null, error: "invalid_address" };
  }

  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finalize = (available: boolean, error?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        address,
        available,
        latency_ms: available ? Date.now() - start : null,
        ...(error ? { error } : {}),
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false, "timeout"));
    socket.once("error", (error) => finalize(false, error.message));
    socket.connect(parsed.port, parsed.host);
  });
};
