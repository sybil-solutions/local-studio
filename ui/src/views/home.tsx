import { useMemo, useState } from "react";
import { Empty, Err, FieldRow, SectionHeading } from "../components/basics";
import { ActivityGrid, GpuRow, MachinesStrip, ModelCard, SlotRow } from "../components/cards";
import { cancelLaunch, LaunchDialog, StopDialog, type Target } from "../components/actions";
import { RequestsTable } from "../components/requests";
import { type CardView, gpuRow, homeCards, life, machines, type SlotView, slots, sumActivity } from "../model/view";
import { setState, useStore } from "../store";

export const Home = () => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const dismissed = useStore((s) => s.dismissed);
  const requests = useStore((s) => s.requests);
  const fresh = useStore((s) => s.fresh);
  const error = useStore((s) => s.error);
  const engines = useStore((s) => s.engines);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [stop, setStop] = useState<CardView | null>(null);
  const [run, setRun] = useState<SlotView | null>(null);

  const ms = useMemo(() => machines(fleet, live), [fleet, live]);
  const act = useMemo(() => sumActivity(fleet), [fleet]);
  const cards = useMemo(() => homeCards(ms, live, fleet?.self ?? null, recipes, engines), [ms, live, fleet, recipes, engines]);
  const localReq = useMemo(() => requests.filter((r) => r.via !== "peer").slice(0, 20), [requests]);
  const all = useMemo(() => ms.flatMap((m) => slots(m, recipes[m.id] ?? null, live, fleet?.self ?? null, dismissed)), [ms, recipes, live, fleet, dismissed]);
  const shown = all.filter((s) => s.rank < 1 || s.rank === 2);
  const names = Object.fromEntries(ms.map((m) => [m.id, m.name]));
  const target = (x: { machineId: string; peerId: string | null; readOnly: boolean }): Target => ({ machineId: x.machineId, peerId: x.peerId, readOnly: x.readOnly });

  if (!fleet)
    return (
      <>
        <Err>{error}</Err>
        <Empty head={error ? "cannot reach the controller" : "connecting to the controller"} />
      </>
    );

  const nothing = !ms.some((m) => (m.snap?.gpus.length ?? 0) > 0) && cards.length === 0;

  return (
    <>
      <MachinesStrip ms={ms} />
      <div className="cols">
        <div className="col">
          {act && act.requests > 0 && <ActivityGrid v={life(act)} />}
          {nothing && (
            <Empty
              head={`No GPU found on ${ms.map((m) => m.name).join(", ") || "this machine"} yet`}
              action={
                <a className="ink" href="#/connect">
                  connect a controller ›
                </a>
              }
            />
          )}
          <div className="gap-top" />
          {cards.map((c) => (
            <ModelCard key={c.key} c={c} onStop={setStop} onCancel={(x) => x.launchId && void cancelLaunch(target(x), x.launchId).then(setCancelErr)} />
          ))}
          <Err>{cancelErr}</Err>
          {shown.length > 0 && <SectionHeading>available</SectionHeading>}
          {shown.map((s) => (
            <SlotRow
              key={s.key}
              s={s}
              showMachine={ms.length > 1}
              onRun={setRun}
              onDismiss={(x) => x.launchId && setState((st) => ({ dismissed: new Set([...st.dismissed, x.launchId!]) }))}
            />
          ))}
          <div className="gap-block" />
          {ms
            .filter((m) => m.gpuCount > 0)
            .map((m) => (
              <FieldRow key={m.id} icon="gpu" label={ms.length > 1 ? `all GPUs · ${m.name}` : "all GPUs"} value={`${m.gpuCount} ›`} href={`#/m/${encodeURIComponent(m.id)}`} />
            ))}
        </div>
        <div className="col">
          <SectionHeading aside={<a className="label" href="#/metrics">metrics ›</a>}>recent requests</SectionHeading>
          <RequestsTable rows={localReq} fresh={fresh} machineNames={names} compact />
          {ms
            .filter((m) => m.snap && m.snap.gpus.length > 0)
            .map((m) => (
              <div key={m.id}>
                <SectionHeading aside={<a className="label" href={`#/m/${encodeURIComponent(m.id)}`}>{m.name} ›</a>}>gpus</SectionHeading>
                {m.snap!.gpus.map((g) => (
                  <GpuRow key={g.key} g={gpuRow(g, m.snap, true)} wide />
                ))}
              </div>
            ))}
        </div>
      </div>
      {stop && stop.modelId && (
        <StopDialog t={target(stop)} modelId={stop.modelId} name={stop.name} watchdog={stop.watchdog} blocked={stop.stopBlocked} onClose={() => setStop(null)} />
      )}
      {run?.run && (
        <LaunchDialog
          t={target(run)}
          recipe={recipes[run.machineId]?.find((r) => r.id === run.run!.recipeId) ?? null}
          recipeId={run.run.recipeId}
          gpuKeys={run.run.gpuKeys}
          onClose={() => setRun(null)}
        />
      )}
    </>
  );
};
