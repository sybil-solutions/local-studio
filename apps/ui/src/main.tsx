import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { KeyPrompt } from "./components/actions";
import { Boundary } from "./components/basics";
import { start, useStore } from "./store";
import { Nav } from "./components/nav";
import { AgentsPage, ConnectPage, RunPage } from "./views/pages";
import { ControlPage } from "./views/control";
import { LivePage } from "./views/live";
import { UsagePage } from "./views/usage";

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

const App = () => {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [page = "control", ...rest] = path.split("/").map(decodeURIComponent);
  const params = new URLSearchParams(query);
  const needKey = useStore((s) => s.needKey);
  const clean = path.split("/").map(decodeURIComponent).join("/");
  const view =
    page === "live" ? (
      <LivePage />
    ) : page === "usage" ? (
      <UsagePage />
    ) : page === "run" ? (
      <RunPage machine={params.get("m")} gpus={params.get("gpus")} />
    ) : page === "agents" ? (
      <AgentsPage model={params.get("model")} />
    ) : page === "connect" ? (
      <ConnectPage />
    ) : (
      <ControlPage sub={page === "models" ? ["model", rest.join("/")] : page === "machines" ? (rest.length ? ["machine", rest.join("/")] : ["machines"]) : page === "endpoints" ? ["endpoints"] : []} />
    );
  return (
    <div className="shell2">
      <Nav path={clean || "control"} />
      <main className="content">
        <Boundary key={page} name={page}>
          {view}
        </Boundary>
      </main>
      {needKey && <KeyPrompt />}
    </div>
  );
};

window.addEventListener("unhandledrejection", (e) => console.error("unhandled", e.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary name="app">
      <App />
    </Boundary>
  </StrictMode>,
);
void start();
