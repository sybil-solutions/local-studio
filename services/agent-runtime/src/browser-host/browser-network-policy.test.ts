import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createSocketServer, type Server } from "node:net";
import test from "node:test";
import {
  browserNavigation,
  classifyBrowserAddress,
  type BrowserAddressClass,
} from "../../../../shared/agent/sanitize-embedded-browser-url";
import { createBrowserNetworkPolicy, type BrowserHostResolver } from "./network-policy";
import { createPinningProxy, type PinnedDial } from "./pinning-proxy";
import { playwrightArguments, playwrightProxySettings } from "./playwright";

const addressCases: ReadonlyArray<readonly [string, BrowserAddressClass]> = [
  ["8.8.8.8", "public"],
  ["93.184.216.34", "public"],
  ["127.0.0.1", "loopback"],
  ["127.255.255.255", "loopback"],
  ["0.0.0.0", "blocked"],
  ["10.0.0.1", "blocked"],
  ["100.64.0.1", "blocked"],
  ["100.127.255.255", "blocked"],
  ["169.254.169.254", "blocked"],
  ["172.31.255.255", "blocked"],
  ["192.0.0.1", "blocked"],
  ["192.0.2.1", "blocked"],
  ["192.31.196.1", "blocked"],
  ["192.52.193.1", "blocked"],
  ["192.88.99.1", "blocked"],
  ["192.168.1.1", "blocked"],
  ["192.175.48.1", "blocked"],
  ["198.18.0.1", "blocked"],
  ["198.19.255.255", "blocked"],
  ["198.51.100.1", "blocked"],
  ["203.0.113.1", "blocked"],
  ["224.0.0.1", "blocked"],
  ["240.0.0.1", "blocked"],
  ["255.255.255.255", "blocked"],
  ["2001:4860:4860::8888", "public"],
  ["2606:4700:4700::1111", "public"],
  ["::1", "loopback"],
  ["::", "blocked"],
  ["64:ff9b::808:808", "blocked"],
  ["64:ff9b:1::1", "blocked"],
  ["100::1", "blocked"],
  ["2001::1", "blocked"],
  ["2001:db8::1", "blocked"],
  ["2002::1", "blocked"],
  ["2620:4f:8000::1", "blocked"],
  ["3fff::1", "blocked"],
  ["5f00::1", "blocked"],
  ["fc00::1", "blocked"],
  ["fd00::1", "blocked"],
  ["fe80::1", "blocked"],
  ["fec0::1", "blocked"],
  ["ff02::1", "blocked"],
  ["::ffff:8.8.8.8", "public"],
  ["::ffff:808:808", "public"],
  ["::ffff:10.0.0.1", "blocked"],
  ["::ffff:a00:1", "blocked"],
  ["0:0:0:0:0:ffff:127.0.0.1", "loopback"],
  ["::ffff:7f00:1", "loopback"],
  ["fe80::1%lo0", "blocked"],
  ["not-an-address", "blocked"],
];

test("classifies complete browser address policy ranges", () => {
  for (const [address, expected] of addressCases) {
    assert.equal(classifyBrowserAddress(address), expected, address);
  }
});

test("derives public and explicit loopback navigation modes", () => {
  assert.deepEqual(browserNavigation("https://example.com/path"), {
    mode: "public",
    url: "https://example.com/path",
  });
  for (const value of [
    "http://localhost:3000",
    "http://localhost.:3000",
    "http://app.localhost:3000",
    "http://app.localhost.:3000",
    "http://127.2.3.4:3000",
    "http://[::1]:3000",
    "http://[::ffff:7f00:1]:3000",
  ]) {
    assert.equal(browserNavigation(value)?.mode, "loopback", value);
  }
  for (const value of [
    "http://host.local",
    "http://10.0.0.1",
    "http://[fe80::1]",
    "file:///tmp/private",
    "ftp://example.com/file",
    "https://user:password@example.com",
  ]) {
    assert.equal(browserNavigation(value), null, value);
  }
});

test("Playwright launch policy removes implicit bypasses and non-proxied transports", () => {
  const proxy = "http://127.0.0.1:4567";
  const args = playwrightArguments();
  assert.deepEqual(playwrightProxySettings(proxy), { bypass: "<-loopback>", server: proxy });
  assert.ok(args.includes("--proxy-bypass-list=<-loopback>"));
  assert.ok(args.includes("--disable-quic"));
  assert.ok(args.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"));
  assert.equal(
    args.some((argument) => argument.includes("direct://")),
    false,
  );
});

function resolver(
  entries: Record<string, ReadonlyArray<{ address: string; family: 4 | 6 }>>,
): BrowserHostResolver {
  return async (hostname) => entries[hostname] ?? [];
}

test("fails closed on zero, malformed, blocked, and mixed DNS answers", async () => {
  const policy = createBrowserNetworkPolicy({
    resolver: resolver({
      blocked: [{ address: "10.0.0.1", family: 4 }],
      malformed: [{ address: "8.8.8.8", family: 6 }],
      mixed: [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
  });
  for (const hostname of ["empty", "blocked", "malformed", "mixed"]) {
    await assert.rejects(
      policy.resolve(`http://${hostname}/`, "public"),
      /blocked|resolved|address/i,
    );
  }
  const timedOut = createBrowserNetworkPolicy({
    resolver: () => new Promise(() => undefined),
    timeoutMs: 1,
  });
  await assert.rejects(timedOut.resolve("https://timeout.test", "public"), /timed out/u);
});

test("allows one DNS class compatible with the top-level mode and pins its first answer", async () => {
  const policy = createBrowserNetworkPolicy({
    resolver: resolver({
      loopback: [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
      public: [
        { address: "8.8.8.8", family: 4 },
        { address: "2001:4860:4860::8888", family: 6 },
      ],
    }),
  });
  assert.equal((await policy.resolve("https://public/", "public")).address.address, "8.8.8.8");
  assert.equal((await policy.resolve("http://loopback/", "loopback")).address.address, "127.0.0.1");
  assert.equal((await policy.resolve("https://public/", "loopback")).address.address, "8.8.8.8");
  await assert.rejects(policy.resolve("http://loopback/", "public"), /blocked/i);
});

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Missing test server address"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}

function proxyGet(port: number, target: string): Promise<{ body: string; status: number }> {
  return new Promise((resolveRequest, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        method: "GET",
        path: target,
        port,
        headers: { host: new URL(target).host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolveRequest({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function proxyExchange(port: number, message: string): Promise<string> {
  return new Promise((resolveExchange, reject) => {
    const socket = netConnect({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000, () => socket.destroy(new Error("Proxy exchange timed out")));
    socket.once("connect", () => socket.write(message));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => resolveExchange(Buffer.concat(chunks).toString("utf8")));
    socket.once("error", reject);
  });
}

test("blocks a denied destination before opening any target connection", async () => {
  let accepted = 0;
  const blocked = createServer((_request, response) => response.end("unsafe"));
  blocked.on("connection", () => {
    accepted += 1;
  });
  const blockedPort = await listen(blocked);
  const dial: PinnedDial = ({ port }) => {
    throw new Error(`unexpected dial to ${port}`);
  };
  const proxy = await createPinningProxy({
    dial,
    mode: "public",
    policy: createBrowserNetworkPolicy({
      resolver: resolver({ blocked: [{ address: "127.0.0.1", family: 4 }] }),
    }),
  });
  try {
    const result = await proxyGet(proxy.port, `http://blocked:${blockedPort}/private`);
    assert.equal(result.status, 403);
    assert.equal(accepted, 0);
  } finally {
    await proxy.close();
    await close(blocked);
  }
});

test("pins allowed HTTP to one address while preserving the original Host", async () => {
  let host = "";
  const destinations: string[] = [];
  const origin = createServer((request, response) => {
    host = request.headers.host ?? "";
    response.end("pinned");
  });
  const originPort = await listen(origin);
  const proxy = await createPinningProxy({
    dial: (destination) => {
      destinations.push(`${destination.address.address}|${destination.hostname}`);
      return netConnect({ host: "127.0.0.1", port: originPort });
    },
    mode: "loopback",
    policy: createBrowserNetworkPolicy({
      resolver: resolver({ origin: [{ address: "8.8.8.8", family: 4 }] }),
    }),
  });
  try {
    const result = await proxyGet(proxy.port, `http://origin:${originPort}/resource`);
    assert.deepEqual(result, { body: "pinned", status: 200 });
    assert.equal(host, `origin:${originPort}`);
    assert.deepEqual(destinations, ["8.8.8.8|origin"]);
  } finally {
    await proxy.close();
    await close(origin);
  }
});

test("blocks CONNECT and WebSocket upgrade before dialing a target", async () => {
  let dials = 0;
  const proxy = await createPinningProxy({
    dial: () => {
      dials += 1;
      throw new Error("unexpected target dial");
    },
    mode: "public",
    policy: createBrowserNetworkPolicy({
      resolver: resolver({ blocked: [{ address: "10.0.0.1", family: 4 }] }),
    }),
  });
  try {
    const connectResponse = await proxyExchange(
      proxy.port,
      "CONNECT blocked:443 HTTP/1.1\r\nHost: blocked:443\r\n\r\n",
    );
    const upgradeResponse = await proxyExchange(
      proxy.port,
      "GET http://blocked/socket HTTP/1.1\r\nHost: blocked\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    assert.match(connectResponse, /^HTTP\/1\.1 403/u);
    assert.match(upgradeResponse, /^HTTP\/1\.1 403/u);
    assert.equal(dials, 0);
  } finally {
    await proxy.close();
  }
});

test("CONNECT tunnels bytes only to the policy-selected address", async () => {
  const origin = createSocketServer((socket) => socket.pipe(socket));
  const originPort = await listen(origin);
  const destinations: string[] = [];
  const proxy = await createPinningProxy({
    dial: (destination) => {
      destinations.push(
        `${destination.address.address}|${destination.hostname}|${destination.port}`,
      );
      return netConnect({ host: "127.0.0.1", port: originPort });
    },
    mode: "public",
    policy: createBrowserNetworkPolicy({
      resolver: resolver({ secure: [{ address: "8.8.8.8", family: 4 }] }),
    }),
  });
  try {
    const tunneled = await new Promise<string>((resolveTunnel, reject) => {
      const socket = netConnect({ host: "127.0.0.1", port: proxy.port });
      let output = "";
      let connected = false;
      socket.setTimeout(2_000, () => socket.destroy(new Error("CONNECT tunnel timed out")));
      socket.once("connect", () =>
        socket.write("CONNECT secure:443 HTTP/1.1\r\nHost: secure:443\r\n\r\n"),
      );
      socket.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (!connected && output.includes("\r\n\r\n")) {
          connected = true;
          socket.write("pinned");
        }
        if (connected && output.endsWith("pinned")) {
          socket.end();
          resolveTunnel(output);
        }
      });
      socket.once("error", reject);
    });
    assert.match(tunneled, /^HTTP\/1\.1 200 Connection Established/u);
    assert.deepEqual(destinations, ["8.8.8.8|secure|443"]);
  } finally {
    await proxy.close();
    await close(origin);
  }
});
