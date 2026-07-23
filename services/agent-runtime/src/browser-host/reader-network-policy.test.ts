import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createBrowserNetworkPolicy } from "./network-policy";
import { fetchReadable, type ReaderTransport } from "./reader";

function response(url: string, options: { location?: string; status?: number } = {}) {
  const status = options.status ?? 200;
  return {
    body: "# Ready",
    contentType: "text/markdown",
    ok: status >= 200 && status < 300,
    status,
    url,
    ...(options.location ? { location: options.location } : {}),
  };
}

test("reader keeps one explicit mode and pins every redirect before transport", async () => {
  const resolutions: string[] = [];
  const policy = createBrowserNetworkPolicy({
    resolver: async (hostname) => {
      resolutions.push(hostname);
      return [{ address: "8.8.8.8", family: 4 }];
    },
  });
  const destinations: string[] = [];
  const transport: ReaderTransport = async (destination) => {
    destinations.push(`${destination.address.address}|${destination.url.hostname}`);
    return destination.url.hostname === "first.test"
      ? response(destination.url.toString(), {
          location: "https://second.test/final",
          status: 302,
        })
      : response(destination.url.toString());
  };

  const result = await fetchReadable("https://first.test/start", "public", {
    policy,
    transport,
  });

  assert.deepEqual(resolutions, ["first.test", "second.test"]);
  assert.deepEqual(destinations, ["8.8.8.8|first.test", "8.8.8.8|second.test"]);
  assert.equal(result.url, "https://second.test/final");
});

test("reader rejects a blocked redirect before the transport opens a connection", async () => {
  const policy = createBrowserNetworkPolicy({
    resolver: async (hostname) => [
      { address: hostname === "blocked.test" ? "10.0.0.1" : "8.8.8.8", family: 4 },
    ],
  });
  let requests = 0;
  const transport: ReaderTransport = async (destination) => {
    requests += 1;
    return response(destination.url.toString(), {
      location: "http://blocked.test/secret",
      status: 302,
    });
  };

  await assert.rejects(
    fetchReadable("https://allowed.test", "public", { policy, transport }),
    /blocked destination/u,
  );
  assert.equal(requests, 1);
});

test("reader allows loopback only when the caller selected loopback mode", async () => {
  const policy = createBrowserNetworkPolicy();
  const transport: ReaderTransport = async (destination) => response(destination.url.toString());

  await assert.rejects(
    fetchReadable("http://127.0.0.1:4321", "public", { policy, transport }),
    /url rejected/u,
  );
  const result = await fetchReadable("http://127.0.0.1:4321", "loopback", {
    policy,
    transport,
  });
  assert.equal(result.url, "http://127.0.0.1:4321/");
});

test("reader transport pins the selected address and preserves the original Host", async () => {
  let host = "";
  const server = createServer((request, response) => {
    host = request.headers.host ?? "";
    response.setHeader("content-type", "text/plain");
    response.end("reader pinned");
  });
  const port = await new Promise<number>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Missing reader fixture address"));
        return;
      }
      resolveListen(address.port);
    });
  });
  try {
    const policy = createBrowserNetworkPolicy({
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const result = await fetchReadable(`http://localhost:${port}/`, "loopback", { policy });
    assert.equal(result.text, "reader pinned");
    assert.equal(host, `localhost:${port}`);
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
});
