import {
  Agent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { Effect } from "effect";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  BrowserNetworkPolicyError,
  type BrowserNetworkPolicy,
  type PinnedBrowserDestination,
} from "./network-policy";

const PROXY_HOST = "127.0.0.1";
const CONNECT_TIMEOUT_MS = 10_000;

export type PinnedDial = (destination: PinnedBrowserDestination) => Socket;
export type PinningProxy = {
  close: () => Promise<void>;
  mode: BrowserNetworkMode;
  port: number;
  url: string;
};

function defaultDial(destination: PinnedBrowserDestination): Socket {
  return netConnect({
    family: destination.address.family,
    host: destination.address.address,
    port: destination.port,
  });
}

function statusFor(error: unknown): number {
  return error instanceof BrowserNetworkPolicyError ? 403 : 502;
}

function responseMessage(status: number): string {
  return status === 403 ? "Browser network policy blocked destination" : "Pinned proxy failure";
}

function failHttp(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status = statusFor(error);
  response.writeHead(status, { connection: "close", "content-type": "text/plain" });
  response.end(responseMessage(status));
}

function failSocket(socket: Duplex, error: unknown): void {
  if (!socket.destroyed) {
    const status = statusFor(error);
    const message = responseMessage(status);
    socket.end(
      `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
    );
  }
}

function withoutHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const output: IncomingHttpHeaders = { ...headers };
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    delete output[name];
  }
  return output;
}

function requestHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  return { ...withoutHopHeaders(headers), host };
}

function absoluteRequestUrl(request: IncomingMessage): URL {
  const url = new URL(request.url ?? "");
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new BrowserNetworkPolicyError("Pinned proxy rejected request URL");
  }
  return url;
}

function authorityUrl(authority: string): URL {
  const url = new URL(`https://${authority}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new BrowserNetworkPolicyError("Pinned proxy rejected CONNECT authority");
  }
  return url;
}

function rememberSocket(socket: Socket, sockets: Set<Socket>): Socket {
  sockets.add(socket);
  socket.on("error", () => undefined);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

function pinnedSocket(socket: Socket, sockets: Set<Socket>): Socket {
  rememberSocket(socket, sockets);
  socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
    socket.destroy(new Error("Pinned connection timed out")),
  );
  socket.once("connect", () => socket.setTimeout(0));
  return socket;
}

function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return withoutHopHeaders(headers);
}

function pinnedAgent(
  destination: PinnedBrowserDestination,
  dial: PinnedDial,
  sockets: Set<Socket>,
): Agent {
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = () => pinnedSocket(dial(destination), sockets);
  return agent;
}

async function forwardHttp(
  request: IncomingMessage,
  response: ServerResponse,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
  dial: PinnedDial,
  sockets: Set<Socket>,
): Promise<void> {
  const url = absoluteRequestUrl(request);
  const destination = await policy.resolve(url.toString(), mode);
  const outgoing = httpRequest(
    {
      agent: pinnedAgent(destination, dial, sockets),
      family: destination.address.family,
      headers: requestHeaders(request.headers, url.host),
      hostname: destination.address.address,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      port: destination.port,
      protocol: "http:",
    },
    (origin) => {
      response.writeHead(origin.statusCode ?? 502, responseHeaders(origin.headers));
      origin.pipe(response);
    },
  );
  outgoing.once("error", (error) => failHttp(response, error));
  request.once("aborted", () => outgoing.destroy());
  request.pipe(outgoing);
}

function serializedHeaders(headers: IncomingHttpHeaders, host: string): string {
  const output = requestHeaders(headers, host);
  output.connection = "Upgrade";
  output.upgrade = headers.upgrade ?? "websocket";
  return Object.entries(output)
    .flatMap(([name, value]) =>
      Array.isArray(value)
        ? value.map((entry) => `${name}: ${entry}`)
        : [`${name}: ${value ?? ""}`],
    )
    .join("\r\n");
}

async function forwardUpgrade(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
  dial: PinnedDial,
  sockets: Set<Socket>,
): Promise<void> {
  const url = absoluteRequestUrl(request);
  const websocketUrl = `ws://${url.host}${url.pathname}${url.search}`;
  const destination = await policy.resolve(websocketUrl, mode);
  const upstream = pinnedSocket(dial(destination), sockets);
  let connected = false;
  upstream.once("error", (error) => (connected ? client.destroy() : failSocket(client, error)));
  upstream.once("connect", () => {
    connected = true;
    upstream.write(
      `${request.method ?? "GET"} ${url.pathname}${url.search} HTTP/${request.httpVersion}\r\n${serializedHeaders(
        request.headers,
        url.host,
      )}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
}

async function forwardConnect(
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
  dial: PinnedDial,
  sockets: Set<Socket>,
): Promise<void> {
  const url = authorityUrl(request.url ?? "");
  const destination = await policy.resolve(url.toString(), mode);
  const upstream = pinnedSocket(dial(destination), sockets);
  let connected = false;
  upstream.once("error", (error) => (connected ? client.destroy() : failSocket(client, error)));
  upstream.once("connect", () => {
    connected = true;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
}

function listen(server: Server): Promise<number> {
  const effect = Effect.tryPromise({
    try: () =>
      new Promise<number>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, PROXY_HOST, () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Pinned proxy did not bind a TCP port"));
            return;
          }
          resolveListen(address.port);
        });
      }),
    catch: (error) => new Error(`Pinned proxy failed to listen: ${String(error)}`),
  });
  return Effect.runPromise(effect);
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  const effect = Effect.tryPromise({
    try: () =>
      new Promise<void>((resolveClose, reject) => {
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
    catch: (error) => new Error(`Pinned proxy failed to close: ${String(error)}`),
  });
  return Effect.runPromise(effect);
}

export async function createPinningProxy({
  dial = defaultDial,
  mode,
  policy,
}: {
  dial?: PinnedDial;
  mode: BrowserNetworkMode;
  policy: BrowserNetworkPolicy;
}): Promise<PinningProxy> {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void forwardHttp(request, response, mode, policy, dial, sockets).catch((error) =>
      failHttp(response, error),
    );
  });
  server.on("connection", (socket) => rememberSocket(socket, sockets));
  server.on("connect", (request, client, head) => {
    void forwardConnect(request, client, head, mode, policy, dial, sockets).catch((error) =>
      failSocket(client, error),
    );
  });
  server.on("upgrade", (request, client, head) => {
    void forwardUpgrade(request, client, head, mode, policy, dial, sockets).catch((error) =>
      failSocket(client, error),
    );
  });
  const port = await listen(server);
  let closing: Promise<void> | null = null;
  return {
    close: () => (closing ??= closeServer(server, sockets)),
    mode,
    port,
    url: `http://${PROXY_HOST}:${port}`,
  };
}

export async function createBrowserPinningProxies(
  policy: BrowserNetworkPolicy,
): Promise<Record<BrowserNetworkMode, PinningProxy>> {
  const publicProxy = await createPinningProxy({ mode: "public", policy });
  try {
    const loopbackProxy = await createPinningProxy({ mode: "loopback", policy });
    return { loopback: loopbackProxy, public: publicProxy };
  } catch (error) {
    await publicProxy.close();
    throw error;
  }
}
