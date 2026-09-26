import type { RequestRecord } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { type Col, Table } from "./basics";
import { hitText } from "./cards";

const time = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export const RequestsTable = ({ rows, fresh, machineNames, compact }: { rows: RequestRecord[]; fresh: Set<string>; machineNames?: Record<string, string>; compact?: boolean }) => {
  const cols: Col<RequestRecord>[] = [
    { h: "time", c: (r) => <span title={new Date(r.tsStart).toISOString()}>{time(r.tsStart)}</span> },
    ...(machineNames && Object.keys(machineNames).length > 1 ? [{ h: "machine", c: (r: RequestRecord) => machineNames[r.machineId] ?? r.machineId.slice(0, 8) }] : []),
    { h: "model", c: (r) => <span className="cut">{r.model}</span> },
    { h: "client", c: (r) => r.client },
    ...(compact ? [] : [{ h: "api", c: (r: RequestRecord) => `${r.dialect}${r.stream ? "" : " ·sync"}${r.via === "peer" ? " ·peer" : ""}` }]),
    { h: "in", n: true, c: (r) => fmt.k(r.inputUncached) },
    { h: "cached", n: true, c: (r) => (r.cacheSource === null && r.via === "local" && r.promptTotal > 0 ? "?" : fmt.k(r.cacheRead)) },
    { h: "out", n: true, c: (r) => fmt.k(r.output) },
    ...(compact ? [] : [{ h: "hit", n: true, c: (r: RequestRecord) => (r.cacheSource === null ? "–" : hitText(r.cacheRead, r.promptTotal)) }]),
    { h: "ttft", n: true, c: (r) => fmt.ms(r.ttftMs) },
    { h: "tok/s", n: true, c: (r) => fmt.tps(r.decodeTps) },
    ...(compact ? [] : [{ h: "prefill", n: true, c: (r: RequestRecord) => fmt.tps(r.prefillTps) }]),
    { h: "status", c: (r) => (r.errorCode ? <span title={r.errorMessage ?? ""}>{`${r.status} ${r.errorCode}`}</span> : `${r.status} ${r.finish}`) },
  ];
  return (
    <Table
      cols={cols}
      rows={rows}
      keyOf={(r) => r.id}
      rowClass={(r) => [r.errorCode ? "err" : "", fresh.has(r.id) ? "new" : ""].join(" ")}
    />
  );
};
