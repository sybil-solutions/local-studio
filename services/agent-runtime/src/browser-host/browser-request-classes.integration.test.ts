import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect as netConnect } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Schema } from "effect";
import { BrowserHost, type ScreencastFrame } from "./browser-host";
import { HostedPage } from "./hosted-page";
import {
  createBrowserNetworkPolicy,
  type BrowserNetworkPolicy,
  type PinnedBrowserDestination,
} from "./network-policy";
import { createPinningProxy } from "./pinning-proxy";
import {
  createPlaywrightSessionLauncher,
  findBrowserBinary,
  PlaywrightManager,
} from "./playwright";

const PUBLIC_ADDRESS = "8.8.8.8";
const FrameColorSchema = Schema.Union([
  Schema.Literal("red"),
  Schema.Literal("green"),
  Schema.Literal("other"),
]);
type FrameColor = typeof FrameColorSchema.Type;

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Missing integration server address"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function matrixPage(blockedBase: string, loopbackBase: string): string {
  return `<!doctype html><html><body><script>
const blocked = ${JSON.stringify(blockedBase)};
const image = new Image(); image.src = blocked + "/image"; document.body.append(image);
const script = document.createElement("script"); script.src = blocked + "/script"; document.body.append(script);
const frame = document.createElement("iframe"); frame.src = blocked + "/frame"; document.body.append(frame);
fetch(blocked + "/fetch").catch(() => undefined);
fetch(${JSON.stringify(`${loopbackBase}/direct-loopback`)}).catch(() => undefined);
const xhr = new XMLHttpRequest(); xhr.open("GET", blocked + "/xhr"); xhr.send();
try { new WebSocket(blocked.replace("http:", "ws:") + "/socket"); } catch {}
try { new EventSource(blocked + "/events"); } catch {}
const workerCode = "self.postMessage('started'); fetch(" + JSON.stringify(blocked + "/worker-fetch") + ").catch(() => undefined);";
const worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }))); worker.onmessage = () => { window.workerStarted = true; }; worker.onerror = (event) => { window.workerError = event.message; };
const download = document.createElement("a"); download.href = "/download-redirect"; download.download = "blocked"; document.body.append(download); window.startDownload = () => download.click();
window.matrixStarted = true;
</script></body></html>`;
}

function serviceWorkerPage(): string {
  return `<!doctype html><script>
navigator.serviceWorker.register("/sw.js")
  .then(() => navigator.serviceWorker.ready)
  .then(() => { window.serviceWorkerReady = true; })
  .catch((error) => { window.serviceWorkerError = String(error); });
</script>`;
}

function fixtureServer(blockedBase: string, loopbackBase: string, hosts: string[]): Server {
  return createServer((request, response) => {
    hosts.push(request.headers.host ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `${blockedBase}/redirect-target` });
      response.end();
      return;
    }
    if (request.url === "/download-redirect") {
      response.writeHead(302, { location: `${blockedBase}/download` });
      response.end();
      return;
    }
    if (request.url === "/sw.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(
        `self.addEventListener("install", () => fetch(${JSON.stringify(
          `${blockedBase}/service-worker`,
        )}).catch(() => undefined));`,
      );
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      request.url === "/service-worker"
        ? serviceWorkerPage()
        : matrixPage(blockedBase, loopbackBase),
    );
  });
}

function screencastServer(): Server {
  return createServer((request, response) => {
    const agentPage = request.url === "/b";
    const marker = agentPage ? "AGENT_B_SENTINEL" : "VISIBLE_A_SENTINEL";
    const background = agentPage ? "#00ff00" : "#ff0000";
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><title>${marker}</title><style>html,body{height:100%;margin:0;background:${background}}</style><h1>${marker}</h1>`,
    );
  });
}

async function classifyFrameColor<RawPage>(
  host: BrowserHost<RawPage>,
  frame: ScreencastFrame,
): Promise<FrameColor> {
  const source = JSON.stringify(`data:image/jpeg;base64,${frame.data}`);
  const result = await host.evaluate(`new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Missing canvas context")); return; }
      context.drawImage(image, 0, 0);
      const positions = [0.25, 0.5, 0.75];
      const pixels = positions.flatMap((x) => positions.map((y) =>
        context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data
      ));
      const channels = pixels.reduce(
        (totals, pixel) => totals.map((total, index) => total + pixel[index]),
        [0, 0, 0]
      ).map((total) => total / pixels.length);
      if (channels[0] > 200 && channels[1] < 70 && channels[2] < 70) { resolve("red"); return; }
      if (channels[1] > 200 && channels[0] < 70 && channels[2] < 70) { resolve("green"); return; }
      resolve("other");
    };
    image.onerror = () => reject(new Error("Frame decode failed"));
    image.src = ${source};
  })`);
  return Schema.decodeUnknownSync(FrameColorSchema)(result);
}

function instrumentPolicy(
  policy: BrowserNetworkPolicy,
  attempts: string[],
): BrowserNetworkPolicy {
  return {
    allows: policy.allows,
    resolve: async (raw, mode) => {
      attempts.push(raw);
      return policy.resolve(raw, mode);
    },
  };
}

function attemptedPath(attempts: string[], pathname: string): boolean {
  return attempts.some((raw) => {
    try {
      return new URL(raw).pathname === pathname;
    } catch {
      return false;
    }
  });
}

function attemptedWebSocket(attempts: string[], port: number): boolean {
  return attempts.some((raw) => {
    try {
      const url = new URL(raw);
      return (
        (url.protocol === "ws:" || url.protocol === "https:") &&
        url.hostname === "blocked.test" &&
        url.port === String(port)
      );
    } catch {
      return false;
    }
  });
}

test("static navigation refreshes the visible screencast frame", { timeout: 20_000 }, async () => {
  const fixture = screencastServer();
  const fixturePort = await listen(fixture);
  const profile = await mkdtemp(path.join(os.tmpdir(), "local-studio-browser-frame-"));
  const policy = createBrowserNetworkPolicy();
  const manager = new PlaywrightManager({
    launch: createPlaywrightSessionLauncher((mode) => path.join(profile, mode)),
    policy,
    resolveBinary: findBrowserBinary,
  });
  const host = new BrowserHost(manager, { attachPage: HostedPage.attach });
  try {
    await host.navigate(`http://127.0.0.1:${fixturePort}/a`);
    const first = (await host.pollFrame()).frame;
    assert.ok(first);
    assert.equal(await classifyFrameColor(host, first), "red");
    await host.navigate(`http://127.0.0.1:${fixturePort}/b`);
    const second = (await host.pollFrame()).frame;
    assert.ok(second);
    assert.equal(await classifyFrameColor(host, second), "green");
    assert.equal(await host.getText(), "AGENT_B_SENTINEL");
  } finally {
    await host.stop().catch(() => undefined);
    await Promise.allSettled([close(fixture), rm(profile, { force: true, recursive: true })]);
  }
});

test(
  "Playwright blocks redirects and every browser request class before denied sockets accept",
  { timeout: 40_000 },
  async () => {
    let blockedConnections = 0;
    const blocked = createServer((_request, response) => response.end("unsafe"));
    blocked.on("connection", () => {
      blockedConnections += 1;
    });
    const blockedPort = await listen(blocked);
    const blockedBase = `http://blocked.test:${blockedPort}`;
    const loopbackBase = `http://127.0.0.1:${blockedPort}`;
    const hosts: string[] = [];
    const fixture = fixtureServer(blockedBase, loopbackBase, hosts);
    const fixturePort = await listen(fixture);
    const attempts: string[] = [];
    const policy = instrumentPolicy(
      createBrowserNetworkPolicy({
        resolver: async (hostname) => {
          if (hostname === "page.test") return [{ address: PUBLIC_ADDRESS, family: 4 }];
          if (hostname === "localhost") return [{ address: "127.0.0.1", family: 4 }];
          if (hostname === "blocked.test") return [{ address: "10.0.0.1", family: 4 }];
          return [];
        },
      }),
      attempts,
    );
    const dials: PinnedBrowserDestination[] = [];
    const pinnedProxies = await Promise.all(
      (["public", "loopback"] as const).map((mode) =>
        createPinningProxy({
          dial: (destination) => {
            dials.push(destination);
            return netConnect({ host: "127.0.0.1", port: destination.port });
          },
          mode,
          policy,
        }),
      ),
    );
    const proxies = { loopback: pinnedProxies[1], public: pinnedProxies[0] };
    const profile = await mkdtemp(path.join(os.tmpdir(), "local-studio-browser-policy-"));
    const manager = new PlaywrightManager({
      createProxies: async () => proxies,
      launch: createPlaywrightSessionLauncher((mode) => `${profile}-${mode}`),
      policy,
      resolveBinary: findBrowserBinary,
    });
    const host = new BrowserHost(manager, { attachPage: HostedPage.attach });
    try {
      assert.equal(manager.isAvailable(), true);
      await host.navigate(`http://page.test:${fixturePort}/matrix`);
      const publicGeneration = manager.current()?.generation;
      assert.ok(publicGeneration);
      await host.evaluate(
        "new Promise((resolve, reject) => { const started = Date.now(); const poll = () => { if (window.workerStarted) resolve(true); else if (window.workerError || Date.now() - started > 5000) reject(new Error(window.workerError || 'worker timed out')); else setTimeout(poll, 50); }; poll(); })",
      );
      await host.evaluate("window.startDownload()");
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await host.navigate(`http://page.test:${fixturePort}/redirect`).catch(() => undefined);
      await host.navigate(`http://localhost:${fixturePort}/service-worker`);
      const loopbackGeneration = manager.current()?.generation;
      assert.ok(loopbackGeneration);
      assert.notEqual(loopbackGeneration, publicGeneration);
      const serviceWorkerState = await host.evaluate(
        "new Promise((resolve) => setTimeout(() => resolve({ ready: Boolean(window.serviceWorkerReady) }), 500))",
      );
      assert.ok(serviceWorkerState && typeof serviceWorkerState === "object");
      assert.ok("ready" in serviceWorkerState);
      assert.equal(serviceWorkerState.ready, false);

      for (const pathname of [
        "/image",
        "/script",
        "/frame",
        "/fetch",
        "/direct-loopback",
        "/xhr",
        "/events",
        "/worker-fetch",
        "/download",
        "/redirect-target",
      ]) {
        assert.equal(
          attemptedPath(attempts, pathname),
          true,
          `${pathname}: ${attempts.join(", ")}`,
        );
      }
      assert.equal(attemptedWebSocket(attempts, blockedPort), true, attempts.join(", "));
      assert.equal(attemptedPath(attempts, "/service-worker"), true);
      assert.equal(blockedConnections, 0);
      assert.ok(
        dials.some(
          (destination) =>
            destination.hostname === "page.test" && destination.address.address === PUBLIC_ADDRESS,
        ),
      );
      assert.ok(
        dials.some(
          (destination) =>
            destination.hostname === "localhost" && destination.address.address === "127.0.0.1",
        ),
      );
      assert.ok(hosts.includes(`page.test:${fixturePort}`));
      assert.ok(hosts.includes(`localhost:${fixturePort}`));
    } finally {
      await host.stop().catch(() => undefined);
      await Promise.allSettled([proxies.public.close(), proxies.loopback.close()]);
      await Promise.allSettled([close(fixture), close(blocked)]);
      await rm(profile, { force: true, recursive: true });
    }
  },
);
