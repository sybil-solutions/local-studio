import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  handleAgentAbort,
  handleAgentCompact,
  handleAgentTurn,
  handleRuntimeEvents,
  handleRuntimeSessions,
  handleRuntimeStatus,
  handleSetupChecks,
} from "./http/handlers";
import {
  handleBrowserFetch,
  handleBrowserFrame,
  handleBrowserInput,
  handleBrowserLocalhosts,
  handleBrowserState,
  handleBrowserVerb,
  handleBrowserViewport,
} from "./http/browser-handlers";
import {
  handleProviderLogin,
  handleProviderLoginCancel,
  handleProviderLoginJob,
  handleProviderLoginRespond,
  handleProviderLogout,
  handleProviderModels,
  handleProvidersList,
} from "./http/provider-handlers";
import { markAgentRuntimeProcess } from "./provider-hub";
import { startAutomationScheduler } from "./automation-scheduler";
import {
  handleAutomationCreate,
  handleAutomationDelete,
  handleAutomationPatch,
  handleAutomationRun,
  handleAutomationsList,
  handleGoalDelete,
  handleGoalGet,
  handleGoalPut,
} from "./http/automation-handlers";
import { handleSubagentRun, handleSubagentsList } from "./http/subagent-handlers";

markAgentRuntimeProcess();
startAutomationScheduler();

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
);

app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw));
app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
app.get("/api/agent/setup-checks", () => handleSetupChecks());

app.get("/api/agent/automations", () => handleAutomationsList());
app.post("/api/agent/automations", (c) => handleAutomationCreate(c.req.raw));
app.patch("/api/agent/automations/:id", (c) => handleAutomationPatch(c.req.raw, c.req.param("id")));
app.delete("/api/agent/automations/:id", (c) => handleAutomationDelete(c.req.param("id")));
app.post("/api/agent/automations/:id/run", (c) => handleAutomationRun(c.req.param("id")));
app.get("/api/agent/subagents", (c) => handleSubagentsList(c.req.raw));
app.post("/api/agent/subagents", (c) => handleSubagentRun(c.req.raw));
app.get("/api/agent/goal", (c) => handleGoalGet(c.req.raw));
app.put("/api/agent/goal", (c) => handleGoalPut(c.req.raw));
app.delete("/api/agent/goal", (c) => handleGoalDelete(c.req.raw));

app.get("/api/agent/providers", () => handleProvidersList());
app.get("/api/agent/providers/models", () => handleProviderModels());
app.get("/api/agent/providers/login/:jobId", (c) =>
  handleProviderLoginJob(c.req.raw, c.req.param("jobId")),
);
app.post("/api/agent/providers/login/:jobId/respond", (c) =>
  handleProviderLoginRespond(c.req.raw, c.req.param("jobId")),
);
app.post("/api/agent/providers/login/:jobId/cancel", (c) =>
  handleProviderLoginCancel(c.req.param("jobId")),
);
app.post("/api/agent/providers/:providerId/login", (c) =>
  handleProviderLogin(c.req.raw, c.req.param("providerId")),
);
app.post("/api/agent/providers/:providerId/logout", (c) =>
  handleProviderLogout(c.req.param("providerId")),
);

app.get("/api/agent/browser/fetch", (c) => handleBrowserFetch(c.req.raw));
app.get("/api/agent/browser/frame", () => handleBrowserFrame());
app.post("/api/agent/browser/input", (c) => handleBrowserInput(c.req.raw));
app.get("/api/agent/browser/localhosts", (c) => handleBrowserLocalhosts(c.req.raw));
app.get("/api/agent/browser/state", () => handleBrowserState());
app.post("/api/agent/browser/viewport", (c) => handleBrowserViewport(c.req.raw));
app.post("/api/agent/browser/:verb", (c) => handleBrowserVerb(c.req.raw, c.req.param("verb")));

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});
