#!/usr/bin/env bun
import { runAgentCli } from "./agents";
import { createApp } from "./app";
import { loadConfig } from "./core/config";
import { runDeployCli } from "./deploy";

const USAGE = `local-studio <command>

  serve   [--host 127.0.0.1] [--port 8080] [--home ~/.local-studio] [--data-dir DIR] [--models-dir DIR] [--name NAME] [--read-only]
  deploy  <ssh-host> [--port 8080] [--dir ~/local-studio] [--host <bind>] [--name NAME] [--read-only] [--service] [--no-start] [--replace] [--connect [--allow-actions]] [--local-url URL]
  deploy  stop <ssh-host> [--port 8080] [--dir ~/local-studio]
  agent   run <workspaceId> [--print] [--resume] [--home DIR]
  key     [--home DIR]                       print the admin key
  key     --federation [--actions] [--home DIR]  issue a scoped key for a hub (read + /v1; --actions adds launch/stop/cancel/export)
  version`;

const serve = async (argv: string[]): Promise<number> => {
  const config = loadConfig(argv);
  const app = createApp(config);
  await app.start();
  const server = Bun.serve({ hostname: config.host, port: config.port, idleTimeout: 255, fetch: app.hono.fetch, maxRequestBodySize: 64 * 1024 * 1024 });
  app.ctx.log.info(`local-studio ${config.version} listening on http://${server.hostname}:${server.port} data=${config.dataDir}${config.readOnly ? " read-only" : ""}`);
  const shutdown = async () => {
    server.stop(true);
    await app.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
