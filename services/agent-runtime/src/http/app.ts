import { Hono } from "hono";
import { createLitterBridgeGateway } from "../litter-bridge-gateway";
import {
  handleAgentAbort,
  handleAgentCompact,
  handleAgentTurn,
  handleExtensionUiResponse,
  handleRuntimeEvents,
  handleRuntimeSessions,
  handleRuntimeStatus,
  handleSetupChecks,
} from "./handlers";
import {
  handleBrowserFetch,
  handleBrowserFrame,
  handleBrowserInput,
  handleBrowserLocalhosts,
  handleBrowserState,
  handleBrowserVerb,
  handleBrowserViewport,
} from "./browser-handlers";
import {
  handleProviderLogin,
  handleProviderLoginCancel,
  handleProviderLoginJob,
  handleProviderLoginRespond,
  handleProviderLogout,
  handleProvidersList,
} from "./provider-handlers";
import {
  handleAutomationCreate,
  handleAutomationDelete,
  handleAutomationPatch,
  handleAutomationRun,
  handleAutomationsList,
  handleGoalDelete,
  handleGoalGet,
  handleGoalPut,
} from "./automation-handlers";
import { handleSubagentRun, handleSubagentsList } from "./subagent-handlers";
import { handlePrGet, handlePrMerge } from "./pr-handlers";
import {
  handlePtyClose,
  handlePtyInput,
  handlePtyOpen,
  handlePtyResize,
  handlePtyStream,
} from "./pty-handlers";
import { handleAgentModels } from "./model-handlers";
import {
  handleAllSessions,
  handleSessionGet,
  handleSessionPatch,
  handleSessionsDelete,
  handleSessionsList,
} from "./session-handlers";

export function createAgentRuntimeApp() {
  const app = new Hono();
  const litterBridgeGateway = createLitterBridgeGateway();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
  );
  app.post("/api/litter-bridge/v1", (c) => litterBridgeGateway.handle(c.req.raw));
  app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw));
  app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
  app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
  app.post("/api/agent/runtime/extension-ui", (c) => handleExtensionUiResponse(c.req.raw));
  app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
  app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
  app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
  app.get("/api/agent/setup-checks", () => handleSetupChecks());
  app.get("/api/agent/models", () => handleAgentModels());
  app.post("/api/agent/models", (c) => handleAgentModels(c.req.raw));
  app.get("/api/agent/sessions", (c) => handleSessionsList(c.req.raw));
  app.delete("/api/agent/sessions", () => handleSessionsDelete());
  app.get("/api/agent/sessions/all", (c) => handleAllSessions(c.req.raw));
  app.get("/api/agent/sessions/:id", (c) => handleSessionGet(c.req.raw, c.req.param("id")));
  app.patch("/api/agent/sessions/:id", (c) => handleSessionPatch(c.req.raw, c.req.param("id")));
  app.get("/api/agent/automations", () => handleAutomationsList());
  app.post("/api/agent/automations", (c) => handleAutomationCreate(c.req.raw));
  app.patch("/api/agent/automations/:id", (c) =>
    handleAutomationPatch(c.req.raw, c.req.param("id")),
  );
  app.delete("/api/agent/automations/:id", (c) =>
    handleAutomationDelete(c.req.param("id")),
  );
  app.post("/api/agent/automations/:id/run", (c) => handleAutomationRun(c.req.param("id")));
  app.get("/api/agent/pr", (c) => handlePrGet(c.req.raw));
  app.post("/api/agent/pr/merge", (c) => handlePrMerge(c.req.raw));
  app.get("/api/agent/subagents", (c) => handleSubagentsList(c.req.raw));
  app.post("/api/agent/subagents", (c) => handleSubagentRun(c.req.raw));
  app.get("/api/agent/goal", (c) => handleGoalGet(c.req.raw));
  app.put("/api/agent/goal", (c) => handleGoalPut(c.req.raw));
  app.delete("/api/agent/goal", (c) => handleGoalDelete(c.req.raw));
  app.get("/api/agent/providers", () => handleProvidersList());
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
  app.post("/api/agent/terminal/pty/open", (c) => handlePtyOpen(c.req.raw));
  app.get("/api/agent/terminal/pty/stream", (c) => handlePtyStream(c.req.raw));
  app.post("/api/agent/terminal/pty/input", (c) => handlePtyInput(c.req.raw));
  app.post("/api/agent/terminal/pty/resize", (c) => handlePtyResize(c.req.raw));
  app.post("/api/agent/terminal/pty/close", (c) => handlePtyClose(c.req.raw));
  app.get("/api/agent/browser/fetch", (c) => handleBrowserFetch(c.req.raw));
  app.get("/api/agent/browser/frame", (c) => handleBrowserFrame(c.req.raw));
  app.post("/api/agent/browser/input", (c) => handleBrowserInput(c.req.raw));
  app.get("/api/agent/browser/localhosts", (c) => handleBrowserLocalhosts(c.req.raw));
  app.get("/api/agent/browser/state", (c) => handleBrowserState(c.req.raw));
  app.post("/api/agent/browser/viewport", (c) => handleBrowserViewport(c.req.raw));
  app.post("/api/agent/browser/:verb", (c) => handleBrowserVerb(c.req.raw, c.req.param("verb")));

  return { app, litterBridgeGateway };
}
