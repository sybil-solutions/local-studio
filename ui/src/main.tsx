import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { KeyPrompt } from "./components/actions";
import { Boundary } from "./components/basics";
import { start, useStore } from "./store";
import { AgentsPage } from "./views/agents";
import { FleetPage } from "./views/fleet";
import { MachinePage } from "./views/machine";
import { ModelPage } from "./views/model";
import { Rail } from "./views/rail";
import { UsagePage } from "./views/usage";

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

const App = () => {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [tab = "", a = "", b = ""] = path.split("/").map(decodeURIComponent);
  const needKey = useStore((s) => s.needKey);
  const home = tab === "" || tab === "fleet";
  const page =
    tab === "m" && b ? (
      <ModelPage machineId={a} modelId={b} />
    ) : tab === "m" ? (
      <MachinePage gid={a} />
    ) : tab === "agents" ? (
      <AgentsPage model={new URLSearchParams(query).get("model")} />
    ) : tab === "usage" ? (
      <UsagePage />
    ) : (
      <FleetPage />
    );
  return (
    <div className={`app${home ? " home" : ""}`}>
      <Rail on={tab === "m" ? a : tab || "fleet"} />
      <main className="main">
        <Boundary key={path} name={tab || "fleet"}>
          {page}
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
