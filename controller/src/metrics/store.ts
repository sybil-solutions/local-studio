import type { Database } from "bun:sqlite";
import type { Price, RequestRecord } from "@local-studio/contracts";
import { DECODE_MIN_TOKENS, PREFILL_MIN_TOKENS } from "@local-studio/contracts";
import { checkpoint, migrate } from "../core/db";

const DAY_MS = 86_400_000;

export const MIGRATIONS = [
  `CREATE TABLE requests (
    id TEXT PRIMARY KEY, ts_start INTEGER NOT NULL, ts_upstream INTEGER, ts_first_token INTEGER, ts_end INTEGER NOT NULL, day TEXT NOT NULL,
    machine_id TEXT NOT NULL, model_id TEXT, model TEXT NOT NULL, engine TEXT, client TEXT NOT NULL, workspace_id TEXT, session_id TEXT,
    dialect TEXT NOT NULL, stream INTEGER NOT NULL, via TEXT NOT NULL, peer_id TEXT,
    status INTEGER NOT NULL, finish TEXT NOT NULL, error_code TEXT, error_message TEXT,
    input_uncached INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, output INTEGER NOT NULL, reasoning INTEGER NOT NULL,
    prompt_total INTEGER NOT NULL, total INTEGER NOT NULL, usage_source TEXT NOT NULL, cache_source TEXT, context_window INTEGER,
    ttft_ms INTEGER, decode_ms INTEGER, prefill_tps REAL, decode_tps REAL,
    engine_queue_ms INTEGER, engine_prefill_ms INTEGER, engine_decode_ms INTEGER,
    caps_stripped TEXT, chunk_time0 INTEGER, chunk_dt TEXT, cost_usd REAL);
  CREATE INDEX requests_ts ON requests(ts_start);
  CREATE INDEX requests_day_model ON requests(day, model);
  CREATE INDEX requests_model_ts ON requests(model_id, ts_start);
  CREATE INDEX requests_client_day ON requests(client, day);
  CREATE TABLE request_checks (request_id TEXT PRIMARY KEY, before TEXT, after TEXT, deltas TEXT, agreement TEXT);
  CREATE TABLE engine_samples (ts INTEGER NOT NULL, model_id TEXT NOT NULL, engine TEXT NOT NULL, counters TEXT NOT NULL, gauges TEXT NOT NULL);
  CREATE INDEX engine_samples_model_ts ON engine_samples(model_id, ts);
  CREATE TABLE usage_daily (day TEXT NOT NULL, machine_id TEXT NOT NULL, model TEXT NOT NULL, client TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, input_uncached INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, reasoning INTEGER NOT NULL DEFAULT 0,
    decode_tokens INTEGER NOT NULL DEFAULT 0, decode_ms INTEGER NOT NULL DEFAULT 0, prefill_tokens INTEGER NOT NULL DEFAULT 0, prefill_ms INTEGER NOT NULL DEFAULT 0,
    ttft_sum_ms INTEGER NOT NULL DEFAULT 0, ttft_n INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (day, machine_id, model, client));
  CREATE TABLE prices (model TEXT PRIMARY KEY, input REAL NOT NULL, output REAL NOT NULL, cache_read REAL NOT NULL, cache_write REAL NOT NULL);`,
  `ALTER TABLE usage_daily ADD COLUMN cache_unknown_prompt INTEGER NOT NULL DEFAULT 0;
  UPDATE requests SET prefill_tps = NULL WHERE cache_source IS NULL;
  UPDATE usage_daily SET
    cache_unknown_prompt = (SELECT COALESCE(SUM(r.prompt_total), 0) FROM requests r WHERE r.day = usage_daily.day AND r.machine_id = usage_daily.machine_id
      AND r.model = usage_daily.model AND r.client = usage_daily.client AND r.via = 'local' AND r.cache_source IS NULL),
    prefill_tokens = (SELECT COALESCE(SUM(r.input_uncached), 0) FROM requests r WHERE r.day = usage_daily.day AND r.machine_id = usage_daily.machine_id
      AND r.model = usage_daily.model AND r.client = usage_daily.client AND r.via = 'local' AND r.prefill_tps IS NOT NULL AND r.ttft_ms IS NOT NULL
      AND r.usage_source NOT IN ('estimated','none') AND r.input_uncached >= ${PREFILL_MIN_TOKENS}),
    prefill_ms = (SELECT COALESCE(SUM(r.ttft_ms), 0) FROM requests r WHERE r.day = usage_daily.day AND r.machine_id = usage_daily.machine_id
      AND r.model = usage_daily.model AND r.client = usage_daily.client AND r.via = 'local' AND r.prefill_tps IS NOT NULL AND r.ttft_ms IS NOT NULL
      AND r.usage_source NOT IN ('estimated','none') AND r.input_uncached >= ${PREFILL_MIN_TOKENS})
  WHERE EXISTS (SELECT 1 FROM requests r WHERE r.day = usage_daily.day AND r.machine_id = usage_daily.machine_id AND r.model = usage_daily.model AND r.client = usage_daily.client);`,
  `DROP TABLE IF EXISTS engine_samples; UPDATE requests SET chunk_dt = NULL, chunk_time0 = NULL; CREATE INDEX IF NOT EXISTS requests_model_ts2 ON requests(model, ts_start);`,
  `DROP TABLE IF EXISTS request_checks;`,
];

const MAX_ROWS = 200_000;
const FLUSH_MS = 250;

export type Row = Record<string, string | number | null>;

export const dayFormatter = (tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (ts: number): string => f.format(new Date(ts));
};

export const rowToRecord = (r: Row): RequestRecord => ({
  id: String(r.id),
  tsStart: Number(r.ts_start),
  tsUpstream: r.ts_upstream === null ? null : Number(r.ts_upstream),
  tsFirstToken: r.ts_first_token === null ? null : Number(r.ts_first_token),
  tsEnd: Number(r.ts_end),
  machineId: String(r.machine_id),
  modelId: r.model_id === null ? null : String(r.model_id),
  model: String(r.model),
  engine: (r.engine ?? null) as RequestRecord["engine"],
  client: String(r.client),
  workspaceId: (r.workspace_id ?? null) as string | null,
  sessionId: (r.session_id ?? null) as string | null,
  dialect: r.dialect as RequestRecord["dialect"],
  stream: r.stream === 1,
  via: r.via as RequestRecord["via"],
  peerId: (r.peer_id ?? null) as string | null,
  status: Number(r.status),
  finish: r.finish as RequestRecord["finish"],
  errorCode: (r.error_code ?? null) as RequestRecord["errorCode"],
  errorMessage: (r.error_message ?? null) as string | null,
  inputUncached: Number(r.input_uncached),
  cacheRead: Number(r.cache_read),
  cacheWrite: Number(r.cache_write),
  output: Number(r.output),
  reasoning: Number(r.reasoning),
  promptTotal: Number(r.prompt_total),
  total: Number(r.total),
  usageSource: r.usage_source as RequestRecord["usageSource"],
  cacheSource: (r.cache_source ?? null) as RequestRecord["cacheSource"],
  contextWindow: r.context_window === null ? null : Number(r.context_window),
  ttftMs: r.ttft_ms === null ? null : Number(r.ttft_ms),
  decodeMs: r.decode_ms === null ? null : Number(r.decode_ms),
  prefillTps: r.prefill_tps === null ? null : Number(r.prefill_tps),
  decodeTps: r.decode_tps === null ? null : Number(r.decode_tps),
  engineQueueMs: r.engine_queue_ms === null ? null : Number(r.engine_queue_ms),
  enginePrefillMs: r.engine_prefill_ms === null ? null : Number(r.engine_prefill_ms),
  engineDecodeMs: r.engine_decode_ms === null ? null : Number(r.engine_decode_ms),
  capsStripped: r.caps_stripped ? (JSON.parse(String(r.caps_stripped)) as string[]) : [],
});

export interface Store {
  insert(rec: RequestRecord, costUsd: number | null): void;
  flush(): void;
  queued(): number;
  recent(limit: number, before?: number): RequestRecord[];
  prices(): Price[];
  price(model: string): Price | null;
  putPrice(p: Price): void;
  prune(): void;
  day(ts: number): string;
}

export const createStore = (db: Database, tz: string, onError: (e: unknown) => void): Store => {
  migrate(db, "metrics", MIGRATIONS);
  const day = dayFormatter(tz);
  const ins = db.query(
    `INSERT OR REPLACE INTO requests VALUES ($id,$ts_start,$ts_upstream,$ts_first_token,$ts_end,$day,$machine_id,$model_id,$model,$engine,$client,$workspace_id,$session_id,
     $dialect,$stream,$via,$peer_id,$status,$finish,$error_code,$error_message,$input_uncached,$cache_read,$cache_write,$output,$reasoning,$prompt_total,$total,
     $usage_source,$cache_source,$context_window,$ttft_ms,$decode_ms,$prefill_tps,$decode_tps,$engine_queue_ms,$engine_prefill_ms,$engine_decode_ms,
     $caps_stripped,NULL,NULL,$cost_usd)`,
  );
  const upsert = db.query(
    `INSERT INTO usage_daily (day, machine_id, model, client, requests, errors, input_uncached, cache_read, cache_write, output, reasoning,
       decode_tokens, decode_ms, prefill_tokens, prefill_ms, ttft_sum_ms, ttft_n, cost_usd, cache_unknown_prompt)
     VALUES ($day,$machine_id,$model,$client,1,$errors,$input_uncached,$cache_read,$cache_write,$output,$reasoning,
       $decode_tokens,$decode_ms,$prefill_tokens,$prefill_ms,$ttft_sum_ms,$ttft_n,$cost_usd,$cache_unknown_prompt)
     ON CONFLICT(day, machine_id, model, client) DO UPDATE SET requests=requests+1, errors=errors+excluded.errors,
       input_uncached=input_uncached+excluded.input_uncached, cache_read=cache_read+excluded.cache_read, cache_write=cache_write+excluded.cache_write,
       output=output+excluded.output, reasoning=reasoning+excluded.reasoning, decode_tokens=decode_tokens+excluded.decode_tokens,
       decode_ms=decode_ms+excluded.decode_ms, prefill_tokens=prefill_tokens+excluded.prefill_tokens, prefill_ms=prefill_ms+excluded.prefill_ms,
       ttft_sum_ms=ttft_sum_ms+excluded.ttft_sum_ms, ttft_n=ttft_n+excluded.ttft_n, cost_usd=cost_usd+excluded.cost_usd,
       cache_unknown_prompt=cache_unknown_prompt+excluded.cache_unknown_prompt`,
  );
  const write = (rec: RequestRecord, cost: number | null) => {
    const d = day(rec.tsStart);
    ins.run({
      id: rec.id, ts_start: rec.tsStart, ts_upstream: rec.tsUpstream, ts_first_token: rec.tsFirstToken, ts_end: rec.tsEnd, day: d,
      machine_id: rec.machineId, model_id: rec.modelId, model: rec.model, engine: rec.engine, client: rec.client, workspace_id: rec.workspaceId,
      session_id: rec.sessionId, dialect: rec.dialect, stream: rec.stream ? 1 : 0, via: rec.via, peer_id: rec.peerId, status: rec.status,
      finish: rec.finish, error_code: rec.errorCode, error_message: rec.errorMessage, input_uncached: rec.inputUncached, cache_read: rec.cacheRead,
      cache_write: rec.cacheWrite, output: rec.output, reasoning: rec.reasoning, prompt_total: rec.promptTotal, total: rec.total,
      usage_source: rec.usageSource, cache_source: rec.cacheSource, context_window: rec.contextWindow, ttft_ms: rec.ttftMs, decode_ms: rec.decodeMs,
      prefill_tps: rec.prefillTps, decode_tps: rec.decodeTps, engine_queue_ms: rec.engineQueueMs, engine_prefill_ms: rec.enginePrefillMs,
      engine_decode_ms: rec.engineDecodeMs, caps_stripped: JSON.stringify(rec.capsStripped), cost_usd: cost,
    });
    if (rec.via !== "local") return;
    const measured = rec.usageSource !== "estimated" && rec.usageSource !== "none";
    const dec = measured && rec.decodeTps !== null && rec.decodeMs !== null && rec.output >= DECODE_MIN_TOKENS;
    const known = rec.cacheSource !== null;
    const pre = measured && known && rec.prefillTps !== null && rec.ttftMs !== null && rec.inputUncached >= PREFILL_MIN_TOKENS;
    upsert.run({
      day: d, machine_id: rec.machineId, model: rec.model, client: rec.client, errors: rec.errorCode ? 1 : 0,
      input_uncached: rec.inputUncached, cache_read: rec.cacheRead, cache_write: rec.cacheWrite, output: rec.output, reasoning: rec.reasoning,
      decode_tokens: dec ? rec.output : 0, decode_ms: dec ? rec.decodeMs! : 0, prefill_tokens: pre ? rec.inputUncached : 0, prefill_ms: pre ? rec.ttftMs! : 0,
      ttft_sum_ms: measured && rec.ttftMs !== null ? rec.ttftMs : 0, ttft_n: measured && rec.ttftMs !== null ? 1 : 0, cost_usd: cost ?? 0,
      cache_unknown_prompt: known ? 0 : rec.promptTotal,
    });
  };
  let queue: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    try {
      db.transaction(() => {
        for (const w of batch)
          try {
            w();
          } catch (e) {
            onError(e);
          }
      })();
    } catch (e) {
      onError(e);
    }
  };
  const enqueue = (w: () => void) => {
    queue.push(w);
    if (queue.length >= 256) flush();
    else timer ??= setTimeout(flush, FLUSH_MS);
  };

  const priceRow = (r: Row): Price => ({ model: String(r.model), input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write) });
  return {
    insert: (rec, cost) => enqueue(() => write(rec, cost)),
    flush,
    queued: () => queue.length,
    recent: (limit, before) => {
      flush();
      return db
        .query<Row, [number, number]>("SELECT * FROM requests WHERE ts_start < ? ORDER BY ts_start DESC LIMIT ?")
        .all(before ?? Number.MAX_SAFE_INTEGER, Math.max(1, Math.min(1000, limit)))
        .map(rowToRecord);
    },
    prices: () => db.query<Row, []>("SELECT * FROM prices ORDER BY model").all().map(priceRow),
    price: (model) => {
      const r = db.query<Row, [string]>("SELECT * FROM prices WHERE lower(model) = lower(?)").get(model);
      return r ? priceRow(r) : null;
    },
    putPrice: (p) => {
      db.query("INSERT OR REPLACE INTO prices VALUES (?, ?, ?, ?, ?)").run(p.model, p.input, p.output, p.cacheRead, p.cacheWrite);
    },
    prune: () => {
      flush();
      db.query("DELETE FROM requests WHERE ts_start < ?").run(Date.now() - 90 * DAY_MS);
      db.query(`DELETE FROM requests WHERE ts_start < (SELECT ts_start FROM requests ORDER BY ts_start DESC LIMIT 1 OFFSET ${MAX_ROWS})`).run();
      checkpoint(db);
    },
    day,
  };
};
