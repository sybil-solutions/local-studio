// Loopback HTTP proxy that pins every browser connection to a policy-vetted
// address.
//
// The embedded Chromium is launched with this proxy as its only route to the
// network (loopback included — the implicit bypass is disabled), so every
// request the page makes — first navigation, redirect hop, subresource,
// websocket, CONNECT tunnel — passes through `resolvePinnedDestination`. The
// proxy then dials the exact address that was vetted rather than letting
// anything re-resolve the name, which is what actually closes the DNS
// rebinding window. TLS stays end-to-end: CONNECT is a plain tunnel to the
// pinned address, and certificate validation still happens in Chromium
// against the original hostname.

import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  resolvePinnedDestination,
  type BrowserNetworkMode,
  type PinnedAddress,
  type PinnedDestination,
} from "./network-policy";

export type PinningProxy = { url: string; close: () => Promise<void> };

const DIAL_TIMEOUT_MS = 8_000;

function tracked(socket: Socket, sockets: Set<Socket>): Socket {
  sockets.add(socket);
  socket.on("error", () => undefined);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

/**
 * Connect to the first reachable vetted address. Falling back across the list
 * is safe — every address in it passed the same policy check — and matters on
 * loopback, where the resolver may order ::1 ahead of an IPv4-only dev server.
 */
function dialPinned(destination: PinnedDestination, sockets: Set<Socket>): Promise<Socket> {
  const attempt = (queue: PinnedAddress[]): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const next = queue[0];
      if (!next) {
        reject(new Error(`No reachable address for ${destination.host}`));
        return;
      }
      const socket = connect({
        host: next.address,
        family: next.family,
        port: destination.port,
      });
      const fallback = (error: Error) => {
        socket.destroy();
        if (queue.length > 1) resolve(attempt(queue.slice(1)));
        else reject(error);
      };
      socket.setTimeout(DIAL_TIMEOUT_MS, () => fallback(new Error("Connect timed out")));
      socket.once("error", fallback);
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.removeListener("error", fallback);
        resolve(tracked(socket, sockets));
      });
    });
  return attempt(destination.addresses);
}

function reject(client: Duplex | ServerResponse): void {
  if (client.destroyed) return;
  if ("writeHead" in client) {
    if (!client.headersSent) client.writeHead(403, { connection: "close" });
    client.end();
  } else {
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  }
}

function forwardHeaders(input: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  const output: IncomingHttpHeaders = { ...input, host };
  delete output["proxy-connection"];
  return output;
}

function forwardHttp(
  request: IncomingMessage,
  response: ServerResponse,
  destination: PinnedDestination,
  sockets: Set<Socket>,
): void {
  const url = new URL(destination.url);
  if (url.protocol !== "http:") {
    // https reaches the proxy as CONNECT, never as an absolute-form request.
    reject(response);
    return;
  }
  // Pinning happens through a lookup override (the same shape reader.ts uses):
  // the request carries the original hostname for the Host header, but name
  // resolution is answered from the vetted address list and nothing else.
  const pinnedLookup: RequestOptions["lookup"] = ((
    _hostname: string,
    lookupOptions: unknown,
    callback: (...args: unknown[]) => void,
  ) => {
    const wantsAll = Boolean((lookupOptions as { all?: boolean } | undefined)?.all);
    const first = destination.addresses[0];
    if (wantsAll) callback(null, destination.addresses);
    else callback(null, first?.address, first?.family);
  }) as RequestOptions["lookup"];
  const outgoing = httpRequest(
    {
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: destination.port,
      lookup: pinnedLookup,
      headers: forwardHeaders(request.headers, url.host),
      method: request.method,
      path: `${url.pathname}${url.search}`,
    },
    (origin) => {
      response.writeHead(origin.statusCode ?? 502, origin.headers);
      origin.pipe(response);
    },
  );
  outgoing.once("socket", (socket) => tracked(socket as Socket, sockets));
  outgoing.once("error", () => response.destroy());
  response.once("close", () => outgoing.destroy());
  request.pipe(outgoing);
}

function serializeUpgrade(request: IncomingMessage, url: URL): string {
  const serialized = Object.entries(forwardHeaders(request.headers, url.host))
    .flatMap(([name, value]) =>
      Array.isArray(value) ? value.map((entry) => `${name}: ${entry}`) : [`${name}: ${value ?? ""}`],
    )
    .join("\r\n");
  return `${request.method ?? "GET"} ${url.pathname}${url.search} HTTP/${request.httpVersion}\r\n${serialized}\r\n\r\n`;
}

function tunnel(
  client: Duplex,
  head: Buffer,
  destination: PinnedDestination,
  sockets: Set<Socket>,
  opened: (upstream: Socket) => void,
): void {
  dialPinned(destination, sockets).then(
    (upstream) => {
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      client.once("error", () => upstream.destroy());
      upstream.once("error", () => client.destroy());
      upstream.once("close", () => client.destroy());
      opened(upstream);
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    },
    () => reject(client),
  );
}

export async function startPinningProxy(mode: BrowserNetworkMode): Promise<PinningProxy> {
  const sockets = new Set<Socket>();
  let closed = false;
  let closing: Promise<void> | null = null;

  const resolveOrReject = (
    raw: string,
    client: Duplex | ServerResponse,
    start: (destination: PinnedDestination) => void,
  ): void => {
    void resolvePinnedDestination(raw, mode).then(
      (destination) => {
        if (closed) reject(client);
        else start(destination);
      },
      () => reject(client),
    );
  };

  const server = createServer((request, response) => {
    resolveOrReject(request.url ?? "", response, (destination) =>
      forwardHttp(request, response, destination, sockets),
    );
  });
  server.on("connection", (socket) => tracked(socket, sockets));
  server.on("connect", (request, client, head) => {
    resolveOrReject(`https://${request.url ?? ""}`, client, (destination) =>
      tunnel(client, head, destination, sockets, () =>
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n"),
      ),
    );
  });
  server.on("upgrade", (request, client, head) => {
    resolveOrReject((request.url ?? "").replace(/^http/, "ws"), client, (destination) =>
      tunnel(client, head, destination, sockets, (upstream) =>
        upstream.write(serializeUpgrade(request, new URL(destination.url))),
      ),
    );
  });

  const port = await new Promise<number>((resolvePort, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolvePort(address.port);
      else rejectListen(new Error("Browser pinning proxy failed to listen"));
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      closed = true;
      closing ??= new Promise<void>((resolveClose) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolveClose());
      });
      return closing;
    },
  };
}
