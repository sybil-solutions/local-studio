import { serve } from "@hono/node-server";
import { startAutomationScheduler } from "./automation-scheduler";
import { createAgentRuntimeApp } from "./http/app";
import { createSessionListWatcher } from "./session-list-watcher";

startAutomationScheduler();

const { app } = createAgentRuntimeApp();
const sessionListWatcher = createSessionListWatcher();
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  sessionListWatcher.start();
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});

process.once("exit", () => {
  sessionListWatcher.dispose();
});
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
