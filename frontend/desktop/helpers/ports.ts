import net from "node:net";

/** Returns true if the given TCP port can be bound on `host` right now. */
export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Resolve a usable port, preferring `preferred` (a previously-persisted port)
 * so the embedded server keeps a stable origin across launches/restarts.
 * Falls back to an OS-allocated port only when the preferred one is taken.
 */
export async function resolveStablePort(preferred?: number, host = "127.0.0.1"): Promise<number> {
  if (preferred && (await isPortAvailable(preferred, host))) return preferred;
  return allocatePort(host);
}

export async function allocatePort(host = "127.0.0.1"): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      reject(error);
    });

    server.listen(0, host, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
        return;
      }

      server.close(() => reject(new Error("Unable to allocate local port")));
    });
  });
}
