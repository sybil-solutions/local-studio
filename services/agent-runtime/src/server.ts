import { serve } from "@hono/node-server";
import { startAutomationScheduler } from "./automation-scheduler";
import { browserHost } from "./browser-host/browser-host";
import { createAgentRuntimeApp } from "./http/app";
import { installRuntimeSignalShutdown } from "./runtime-shutdown";

startAutomationScheduler();

const { app, litterBridgeGateway } = createAgentRuntimeApp();
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  litterBridgeGateway.publishMetadata(info.port);
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});

let gatewayDisposed = false;
const disposeGateway = () => {
  if (gatewayDisposed) return;
  gatewayDisposed = true;
  litterBridgeGateway.dispose();
};

process.once("exit", disposeGateway);
installRuntimeSignalShutdown({
  dispose: disposeGateway,
  process,
  reportError: (error) => console.error("[agent-runtime] shutdown failed", error),
  stop: () => browserHost.stop(),
});
