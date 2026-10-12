import { Hono } from "hono";
import {
  handleAgentAbort,
  handleAgentCompact,
  handleAgentTurn,
  handleExtensionUiResponse,
  handleRuntimeEvents,
  handleRuntimeSessions,
  handleRuntimeStatus,
  handleSessionListChanged,
  handleSetupChecks,
} from "./handlers";
import {
  handleBrowserEngineSelect,
  handleBrowserEngines,
  handleBrowserFetch,
  handleBrowserFrame,
  handleBrowserHistory,
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
import {
  handleSubagentGet,
  handleSubagentRun,
  handleSubagentsList,
  handleSubagentStop,
} from "./subagent-handlers";
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
  handleConnectorCall,
  handleConnectorDelete,
  handleConnectorGrantDelete,
  handleConnectorGrantPut,
  handleConnectorGrantsGet,
  handleConnectorInventory,
  handleConnectorsList,
  handleConnectorTest,
  handleConnectorUpsert,
  handleSshServerPath,
} from "./connector-handlers";
import {
  handleGoogleAccountDisconnect,
  handleGoogleAccountGet,
  handleGoogleAuthorizeBegin,
  handleGoogleAuthorizeCancel,
  handleGoogleAuthorizeComplete,
  handleGoogleClientPut,
} from "./google-account-handlers";
import {
  handleOAuthAuthorizeBegin,
  handleOAuthAuthorizeCancel,
  handleOAuthClientPut,
  handleOAuthDisconnect,
  handleOAuthStatus,
  handleOAuthTokenPut,
} from "./oauth-handlers";
import {
  handleProjectAdd,
  handleProjectRemove,
  handleProjectsList,
} from "./project-handlers";
import {
  handlePluginDelete,
  handlePluginSource,
  handlePluginsList,
  handlePluginUpsert,
} from "./plugin-handlers";
import {
  handlePromptTemplateLoad,
  handlePromptTemplatesList,
  handleSkillLoad,
  handleSkillsList,
} from "./discovery-handlers";
import {
  handleAllSessions,
  handleSessionGet,
  handleSessionPatch,
  handleSessionsDelete,
  handleSessionsList,
} from "./session-handlers";
import { handleGenerateSessionTitle } from "./title-handlers";

// The runtime binds loopback only, so every legitimate request carries a
// loopback Host. A browser tricked by DNS rebinding reaches the socket with
// the attacker's hostname in Host — reject those before any route runs.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLoopbackHost = (header: string | undefined): boolean => {
  if (!header) return false;
  const host = header.trim().toLowerCase();
  const name = host.startsWith("[")
    ? host.replace(/\]:\d+$/, "]")
    : host.replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(name);
};

export function createAgentRuntimeApp() {
  const app = new Hono();

  app.use("*", (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
      return Promise.resolve(c.json({ error: "Forbidden host" }, 403));
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
  );
  app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw));
  app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
  app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
  app.post("/api/agent/runtime/extension-ui", (c) => handleExtensionUiResponse(c.req.raw));
  app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
  app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
  app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
  app.get("/api/agent/session-list-changed", (c) => handleSessionListChanged(c.req.raw));
  app.get("/api/agent/setup-checks", () => handleSetupChecks());
  app.get("/api/agent/models", () => handleAgentModels());
  app.post("/api/agent/models", (c) => handleAgentModels(c.req.raw));
  app.get("/api/agent/sessions", (c) => handleSessionsList(c.req.raw));
  app.delete("/api/agent/sessions", () => handleSessionsDelete());
  app.get("/api/agent/sessions/all", (c) => handleAllSessions(c.req.raw));
  app.get("/api/agent/sessions/:id", (c) => handleSessionGet(c.req.raw, c.req.param("id")));
  app.patch("/api/agent/sessions/:id", (c) => handleSessionPatch(c.req.raw, c.req.param("id")));
  app.post("/api/agent/sessions/:id/generate-title", (c) =>
    handleGenerateSessionTitle(c.req.raw, c.req.param("id")),
  );
  app.get("/api/agent/automations", () => handleAutomationsList());
  app.post("/api/agent/automations", (c) => handleAutomationCreate(c.req.raw));
  app.patch("/api/agent/automations/:id", (c) =>
    handleAutomationPatch(c.req.raw, c.req.param("id")),
  );
  app.delete("/api/agent/automations/:id", (c) =>
    handleAutomationDelete(c.req.param("id")),
  );
  app.post("/api/agent/automations/:id/run", (c) => handleAutomationRun(c.req.param("id")));
  app.get("/api/agent/connectors", () => handleConnectorsList());
  app.post("/api/agent/connectors", (c) => handleConnectorUpsert(c.req.raw));
  app.delete("/api/agent/connectors", (c) => handleConnectorDelete(c.req.raw));
  app.get("/api/agent/connectors/call", (c) => handleConnectorInventory(c.req.raw));
  app.post("/api/agent/connectors/call", (c) => handleConnectorCall(c.req.raw));
  app.get("/api/agent/connectors/grants", (c) => handleConnectorGrantsGet(c.req.raw));
  app.put("/api/agent/connectors/grants", (c) => handleConnectorGrantPut(c.req.raw));
  app.delete("/api/agent/connectors/grants", (c) => handleConnectorGrantDelete(c.req.raw));
  app.post("/api/agent/connectors/test", (c) => handleConnectorTest(c.req.raw));
  app.get("/api/agent/connectors/ssh-server-path", () => handleSshServerPath());
  app.post("/api/agent/oauth/authorize", (c) => handleOAuthAuthorizeBegin(c.req.raw));
  app.delete("/api/agent/oauth/authorize", (c) => handleOAuthAuthorizeCancel(c.req.raw));
  app.get("/api/agent/oauth/status", (c) => handleOAuthStatus(c.req.raw));
  app.put("/api/agent/oauth/client", (c) => handleOAuthClientPut(c.req.raw));
  app.put("/api/agent/oauth/token", (c) => handleOAuthTokenPut(c.req.raw));
  app.delete("/api/agent/oauth", (c) => handleOAuthDisconnect(c.req.raw));
  app.get("/api/agent/accounts/google", () => handleGoogleAccountGet());
  app.put("/api/agent/accounts/google", (c) => handleGoogleClientPut(c.req.raw));
  app.delete("/api/agent/accounts/google", (c) => handleGoogleAccountDisconnect(c.req.raw));
  app.post("/api/agent/accounts/google/authorize", (c) => handleGoogleAuthorizeBegin(c.req.raw));
  app.delete("/api/agent/accounts/google/authorize", (c) => handleGoogleAuthorizeCancel(c.req.raw));
  app.post("/api/agent/accounts/google/authorize/complete", (c) =>
    handleGoogleAuthorizeComplete(c.req.raw),
  );
  app.get("/api/agent/projects", () => handleProjectsList());
  app.post("/api/agent/projects", (c) => handleProjectAdd(c.req.raw));
  app.delete("/api/agent/projects", (c) => handleProjectRemove(c.req.raw));
  app.get("/api/agent/plugins", () => handlePluginsList());
  app.post("/api/agent/plugins", (c) => handlePluginUpsert(c.req.raw));
  app.delete("/api/agent/plugins", (c) => handlePluginDelete(c.req.raw));
  app.get("/api/agent/plugins/source", (c) => handlePluginSource(c.req.raw));
  app.get("/api/agent/skills", () => handleSkillsList());
  app.get("/api/agent/skills/load", (c) => handleSkillLoad(c.req.raw));
  app.get("/api/agent/prompt-templates", () => handlePromptTemplatesList());
  app.get("/api/agent/prompt-templates/load", (c) => handlePromptTemplateLoad(c.req.raw));
  app.get("/api/agent/pr", (c) => handlePrGet(c.req.raw));
  app.post("/api/agent/pr/merge", (c) => handlePrMerge(c.req.raw));
  app.get("/api/agent/subagents", (c) => handleSubagentsList(c.req.raw));
  app.post("/api/agent/subagents", (c) => handleSubagentRun(c.req.raw));
  app.get("/api/agent/subagents/:runId", (c) => handleSubagentGet(c.req.raw, c.req.param("runId")));
  app.post("/api/agent/subagents/:runId/stop", (c) =>
    handleSubagentStop(c.req.raw, c.req.param("runId")),
  );
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
  app.get("/api/agent/browser/frame", () => handleBrowserFrame());
  app.post("/api/agent/browser/input", (c) => handleBrowserInput(c.req.raw));
  app.get("/api/agent/browser/localhosts", (c) => handleBrowserLocalhosts(c.req.raw));
  app.get("/api/agent/browser/state", () => handleBrowserState());
  app.get("/api/agent/browser/history", (c) => handleBrowserHistory(c.req.raw));
  app.get("/api/agent/browser/engines", () => handleBrowserEngines());
  app.post("/api/agent/browser/viewport", (c) => handleBrowserViewport(c.req.raw));
  // Registered ahead of the :verb catch-all, which would otherwise reject it.
  app.post("/api/agent/browser/engine", (c) => handleBrowserEngineSelect(c.req.raw));
  app.post("/api/agent/browser/:verb", (c) => handleBrowserVerb(c.req.raw, c.req.param("verb")));

  return { app };
}
