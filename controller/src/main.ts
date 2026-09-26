#!/usr/bin/env bun
import { runAgentCli } from "./agents";
import { createApp } from "./app";
import { loadConfig } from "./core/config";
import { errText } from "./core/log";
import { pairing } from "./core/pair";
import { runDeployCli } from "./deploy";
import { tailscaleBin } from "./federation/tailnet";

const USAGE = `local-studio <command>

  serve   [--host 127.0.0.1] [--port 8080] [--home ~/.local-studio] [--data-dir DIR] [--models-dir DIR] [--name NAME] [--read-only] [--tailnet]
  deploy  <ssh-host> [--port 8080] [--dir ~/local-studio] [--host <bind>] [--name NAME] [--read-only] [--service] [--no-start] [--replace] [--connect [--allow-actions]] [--local-url URL]
  deploy  stop <ssh-host> [--port 8080] [--dir ~/local-studio]
  agent   run <sessionId> [--print] [--home DIR]
  key     [--home DIR]                       print the admin key
  key     --federation [--actions] [--home DIR]  issue a scoped key for a hub (read + /v1; --actions adds launch/stop/cancel/export)
  version`;

const serve = async (argv: string[]): Promise<number> => {
  const config = loadConfig(argv);
  const app = createApp(config);
  const { log, obs } = app.ctx;
  process.on("unhandledRejection", (e) => log.error(`unhandled rejection: ${errText(e)}`, "unhandledRejection"));
  process.on("uncaughtException", (e) => log.error(`uncaught exception: ${errText(e)}`, "uncaughtException"));
  const t0 = performance.now();
  await app.start();
  const server = Bun.serve({ hostname: config.host, port: config.port, idleTimeout: 255, fetch: app.hono.fetch, maxRequestBodySize: 64 * 1024 * 1024 });
  const servers = [server];
  const bin = config.tailnet && config.host !== "0.0.0.0" ? await tailscaleBin() : null;
  const ts = bin ? await app.ctx.exec([bin, "ip", "-4"], { timeoutMs: 5000 }) : null;
  const tsIp = ts?.code === 0 ? ts.stdout.trim().split("\n")[0] : null;
  if (config.tailnet && !tsIp) log.warn("--tailnet: no tailnet IPv4 found; phone access is off");
  if (tsIp && tsIp !== config.host)
    try {
      servers.push(Bun.serve({ hostname: tsIp, port: config.port, idleTimeout: 255, fetch: app.hono.fetch, maxRequestBodySize: 64 * 1024 * 1024 }));
      pairing.base = `http://${tsIp}:${config.port}`;
      log.info(`tailnet listener on ${pairing.base}`);
    } catch (e) {
      log.warn(`tailnet listener on ${tsIp}:${config.port} failed: ${errText(e)}`);
    }
  obs.gauge("http.pending_requests", () => servers.reduce((s, x) => s + x.pendingRequests, 0));
  log.info(`local-studio ${config.version} listening on http://${server.hostname}:${server.port} data=${config.dataDir}${config.readOnly ? " read-only" : ""} startup=${Math.round(performance.now() - t0)}ms`);
  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    const pending = () => servers.reduce((s, x) => s + x.pendingRequests, 0);
    log.info(`${sig}: draining ${pending()} requests`);
    setTimeout(() => process.exit(1), 10_000).unref();
    for (const s of servers) void s.stop(false);
    app.quiesce();
    for (let i = 0; i < 50 && pending() > 0; i++) await Bun.sleep(100);
    for (const s of servers) s.stop(true);
    await app.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  return await new Promise<number>(() => {});
};

const main = async (): Promise<number> => {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "serve":
      return serve(rest);
    case "deploy":
      return runDeployCli(rest);
    case "agent":
      return runAgentCli(rest);
    case "key": {
      const config = loadConfig(rest);
      const app = createApp(config);
      const fed = rest.includes("--federation");
      console.log(fed ? app.ctx.keys.issue("federation", `federation ${new Date().toISOString().slice(0, 10)}`, "federation", rest.includes("--actions")).key : app.ctx.keys.adminKey());
      await app.stop();
      return 0;
    }
    case "version":
      console.log(loadConfig(rest).version);
      return 0;
    default:
      console.log(USAGE);
      return cmd ? 2 : 0;
  }
};

process.exit(await main());
