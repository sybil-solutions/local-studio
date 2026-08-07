import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { browserNetworkPolicy, type BrowserDestination, type BrowserNetworkMode, type BrowserNetworkPolicy } from "./network-policy";
export type BrowserProxy = { close: () => Promise<void>; url: string };
function tracked(socket: Socket, sockets: Set<Socket>): Socket {
  sockets.add(socket);
  socket.on("error", () => undefined);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}
function dial(destination: BrowserDestination, sockets: Set<Socket>): Socket {
  const { address, family } = destination.address;
  return tracked(connect({ family, host: address, port: destination.port }), sockets);
}
function reject(client: Duplex | ServerResponse): void {
  if (client.destroyed) return;
  if ("writeHead" in client) {
    client.writeHead(403, { connection: "close" });
    client.end();
  } else {
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  }
}
function headers(input: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  const output: IncomingHttpHeaders = { ...input, host };
  delete output["proxy-connection"];
  return output;
}
function forwardHttp(request: IncomingMessage, response: ServerResponse, destination: BrowserDestination, sockets: Set<Socket>): void {
  const url = new URL(destination.url);
  const outgoing = httpRequest(
    {
      family: destination.address.family, headers: headers(request.headers, url.host),
      hostname: destination.address.address, method: request.method,
      path: `${url.pathname}${url.search}`, port: destination.port,
    },
    (origin) => {
      response.writeHead(origin.statusCode ?? 502, origin.headers);
      origin.pipe(response);
    },
  );
  outgoing.once("socket", (socket) => tracked(socket, sockets));
  outgoing.once("error", () => response.destroy());
  request.pipe(outgoing);
}
function serializeUpgrade(request: IncomingMessage, url: URL): string {
  const serialized = Object.entries(headers(request.headers, url.host))
    .flatMap(([name, value]) =>
      Array.isArray(value)
        ? value.map((entry) => `${name}: ${entry}`)
        : [`${name}: ${value ?? ""}`],
    )
    .join("\r\n");
  return `${request.method ?? "GET"} ${url.pathname}${url.search} HTTP/${request.httpVersion}\r\n${serialized}\r\n\r\n`;
}
function tunnel(client: Duplex, head: Buffer, destination: BrowserDestination, sockets: Set<Socket>, opened: (upstream: Socket) => void): void {
  const upstream = dial(destination, sockets);
  upstream.once("error", () => client.destroy());
  upstream.once("connect", () => {
    opened(upstream);
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
}
export async function createBrowserProxy(mode: BrowserNetworkMode, policy: BrowserNetworkPolicy = browserNetworkPolicy): Promise<BrowserProxy> {
  const sockets = new Set<Socket>();
  let closed = false;
  let closing: Promise<void> | null = null;
  const resolve = (raw: string, client: Duplex | ServerResponse, start: (destination: BrowserDestination) => void): void => {
    void policy
      .resolve(raw, mode)
      .then((destination) => {
        if (closed) reject(client);
        else start(destination);
      })
      .catch(() => reject(client));
  };
  const server = createServer((request, response) => {
    resolve(request.url ?? "", response, (destination) => forwardHttp(request, response, destination, sockets));
  });
  server.on("connection", (socket) => tracked(socket, sockets));
  server.on("connect", (request, client, head) => {
    resolve(`https://${request.url ?? ""}`, client, (destination) => tunnel(
      client, head, destination, sockets,
      () => client.write("HTTP/1.1 200 Connection Established\r\n\r\n"),
    ));
  });
  server.on("upgrade", (request, client, head) => {
    const raw = request.url ?? "";
    resolve(raw.replace(/^http/u, "ws"), client, (destination) => tunnel(
      client, head, destination, sockets,
      (upstream) => upstream.write(serializeUpgrade(request, new URL(destination.url))),
    ));
  });
  const port = await new Promise<number>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      typeof address === "object" && address
        ? resolve(address.port)
        : rejectListen(new Error("Browser proxy failed to listen"));
    });
  });
  return {
    close: () => {
      closed = true;
      return (closing ??= new Promise<void>((resolve, rejectClose) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? rejectClose(error) : resolve()));
      }));
    },
    url: `http://127.0.0.1:${port}`,
  };
}
