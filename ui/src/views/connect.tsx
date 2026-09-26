import { useEffect, useState } from "react";
import type { Peer, TailnetCandidate } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, post } from "../api";
import { Btn, Err, SectionHeading, Table } from "../components/basics";
import { loadAll, useStore } from "../store";

export const ConnectPage = () => {
  const fleet = useStore((s) => s.fleet);
  const now = useStore((s) => s.now);
  const [cands, setCands] = useState<TailnetCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setScanning(true);
    const r = await get<TailnetCandidate[]>("/api/machines/discover");
    setScanning(false);
    setCands(r.ok && Array.isArray(r.data) ? r.data : []);
    if (!r.ok) setErr(`discover: ${r.error}`);
  };
  useEffect(() => {
    void scan();
  }, []);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    setOk(null);
    const r = await post<Peer>("/api/machines", { url: url.trim(), key: key.trim(), ...(name ? { name } : {}) });
    setBusy(false);
    setKey("");
    if (r.ok) {
      setOk(`connected ${r.data?.name ?? url}`);
      setUrl("");
      setName("");
      void loadAll();
    } else setErr(r.error);
  };

  return (
    <div className="cols">
      <div className="col">
        <SectionHeading>connect a controller</SectionHeading>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <label htmlFor="u">url</label>
          <input id="u" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host:8080" spellCheck={false} />
          <label htmlFor="k">admin key</label>
          <input id="k" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="from: local-studio key print-admin" />
          <label htmlFor="n">name</label>
          <input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" spellCheck={false} />
        </form>
        <div className="btns gut gap-group">
          <Btn kind="primary" onClick={() => void connect()} disabled={busy || !url || key.length < 16}>
            {busy ? "Connecting" : "Connect ›"}
          </Btn>
          {ok && <span className="value">{ok}</span>}
        </div>
        <div className="note gap-block">The key is sent once to this controller, stored there (0600) and never shown again.</div>
        <Err>{err}</Err>
      </div>
      <div className="col">
        <SectionHeading aside={<button type="button" className="btn" onClick={() => void scan()} disabled={scanning}>{scanning ? "Scanning" : "Scan"}</button>}>
          tailnet
        </SectionHeading>
        <Table<TailnetCandidate>
          cols={[
            { h: "host", c: (c) => c.hostName },
            { h: "os", c: (c) => c.os },
            { h: "url", c: (c) => c.url },
            { h: "what", c: (c) => (c.kind === "local-studio" ? "local studio" : c.kind === "legacy-controller" ? "old vLLM Studio" : "nothing on :8080") },
            {
              h: "",
              c: (c) =>
                c.alreadyConnected ? (
                  <span className="label">connected</span>
                ) : c.kind === "local-studio" ? (
                  <button type="button" className="btn" onClick={() => setUrl(c.url)}>
                    Use
                  </button>
                ) : null,
            },
          ]}
          rows={cands ?? []}
          keyOf={(c) => c.dnsName}
          empty={cands === null ? "scanning…" : "no candidates found"}
        />
        <SectionHeading>peers</SectionHeading>
        <Table<Peer>
          cols={[
            { h: "name", c: (p) => p.name },
            { h: "url", c: (p) => p.baseUrl },
            { h: "state", c: (p) => (p.online ? "online" : <span className="alert">offline</span>) },
            { h: "version", c: (p) => p.version ?? "–" },
            { h: "seen", c: (p) => (p.lastSeenAt ? fmt.ago(p.lastSeenAt, now) : "–") },
            { h: "error", c: (p) => (p.error ? <span className="alert">{p.error}</span> : "") },
          ]}
          rows={fleet?.peers ?? []}
          keyOf={(p) => p.id}
          empty="no peers yet"
        />
      </div>
    </div>
  );
};
