import { useMemo } from "react";
import { ConnectDialog } from "../components/actions";
import { H } from "../components/panel";
import { RunPanel } from "../components/run";
import { machines } from "../model/view";
import { useStore } from "../store";
import { AgentsSection } from "./agents";

export const RunPage = ({ machine, gpus }: { machine: string | null; gpus: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const launches = useStore((s) => s.launches);
  const ms = useMemo(() => machines(fleet, launches), [fleet, launches]);
  const initial = useMemo(() => {
    const m = ms.find((x) => x.id === machine);
    if (!m) return {};
    const keys = gpus ? gpus.split(",") : [...new Set((m.snap?.groups ?? []).filter((g) => g.state === "available").flatMap((g) => g.gpuKeys))].sort();
    return { [m.id]: keys };
  }, [machine, gpus, ms.length]);
  return (
    <div className="page2">
      <H>run a model</H>
      <RunPanel key={`${machine}:${gpus}`} machines={ms} initial={initial} onDone={() => (location.hash = "#/control")} />
    </div>
  );
};

export const AgentsPage = ({ model }: { model: string | null }) => (
  <div className="page2">
    <H>agents</H>
    <AgentsSection model={null} only="sessions" bare />
    <H>new agent</H>
    <div className="page">
      <AgentsSection model={model} only="launch" />
    </div>
  </div>
);

export const ConnectPage = () => (
  <div className="page2">
    <H>connect a machine</H>
    <ConnectDialog page onClose={() => (location.hash = "#/control")} />
  </div>
);
