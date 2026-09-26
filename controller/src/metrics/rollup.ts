import type { Database } from "bun:sqlite";
import type { Activity, ModelCardStats, RunningModel } from "@local-studio/contracts";
import { ACTIVITY_DAYS, ratio } from "@local-studio/contracts";
import { AGG, type AggRow, n, sliceOf } from "./summary";

const DAY_MS = 86_400_000;

const addDays = (day: string, k: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + k * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

export const activity = (db: Database, machineId: string, today: string): Activity => {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const start = addDays(monday, -19 * 7);
  const days = new Array<number>(ACTIVITY_DAYS).fill(0);
  const rows = db
    .query<AggRow, [string, string]>(
      "SELECT day, SUM(input_uncached + cache_read + cache_write + output) AS t FROM usage_daily WHERE machine_id = ? AND day >= ? GROUP BY day",
    )
    .all(machineId, start);
  for (const r of rows) {
    const i = dayDiff(start, String(r.day));
    if (i >= 0 && i < ACTIVITY_DAYS) days[i] = n(r.t);
  }
  const all =
    db
      .query<AggRow, [string]>(
        "SELECT SUM(requests) AS r, SUM(input_uncached + cache_read + cache_write + output) AS t, MIN(day) AS since FROM usage_daily WHERE machine_id = ? AND requests > 0",
      )
      .get(machineId) ?? {};
  const week =
    db
      .query<AggRow, [string, string]>("SELECT SUM(input_uncached + cache_read + cache_write + output) AS t FROM usage_daily WHERE machine_id = ? AND day > ?")
      .get(machineId, addDays(today, -7))?.t ?? 0;
  const last = db.query<AggRow, [string]>("SELECT MAX(ts_end) AS l FROM requests WHERE machine_id = ? AND via = 'local'").get(machineId)?.l;
  return {
    start,
    today: dayDiff(start, today),
    days,
    requests: n(all.r),
    total: n(all.t),
    week: n(week),
    since: typeof all.since === "string" ? all.since : null,
    last: typeof last === "number" ? last : null,
  };
};

const LINE_POINTS = 24;

export const card = (db: Database, m: RunningModel, machineId: string, day: (ts: number) => string): ModelCardStats => {
  const now = Date.now();
  const names = [...new Set([m.primaryModel, ...m.servedModels.map((s) => (s.startsWith("/") ? m.primaryModel : s))])];
  const inList = names.map(() => "?").join(",");
  const base = `model IN (${inList}) AND via = 'local'`;
  const q = <P extends (string | number)[]>(sql: string, ...p: P) => db.query<AggRow, (string | number)[]>(sql).get(...names, ...p) ?? {};
  const session = q(`SELECT SUM(total) AS t FROM requests WHERE ${base} AND ts_start >= ?`, m.startedAt ?? 0);
  const week = sliceOf("7d", q(`SELECT ${AGG} FROM requests WHERE ${base} AND ts_start >= ?`, now - 7 * DAY_MS));
  const day24 = q(`SELECT COUNT(*) AS c, SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS e FROM requests WHERE ${base} AND ts_start >= ?`, now - DAY_MS);
  const last = q(`SELECT ts_end AS b FROM requests WHERE ${base} ORDER BY ts_start DESC LIMIT 1`).b;
  const days = db
    .query<AggRow, string[]>(`SELECT day, SUM(input_uncached + cache_read + cache_write + output) AS t FROM usage_daily WHERE model IN (${inList}) AND machine_id = ? GROUP BY day ORDER BY day`)
    .all(...names, machineId);
  const first = days[0] ? String(days[0].day) : null;
  const all = days.reduce((t, r) => t + n(r.t), 0);
  const hour0 = Math.floor(now / 3_600_000) * 3_600_000 - (LINE_POINTS - 1) * 3_600_000;
  const hours = db
    .query<AggRow, (string | number)[]>(`SELECT (ts_start - ?) / 3600000 AS k, SUM(total) AS t FROM requests WHERE ${base} AND ts_start >= ? GROUP BY k`)
    .all(hour0, ...names, hour0);
  const line = new Array<number>(LINE_POINTS).fill(0);
  for (const r of hours) line[Math.max(0, Math.min(LINE_POINTS - 1, n(r.k)))]! += n(r.t);
  line[0]! += Math.max(0, all - line.reduce((t, x) => t + x, 0));
  for (let i = 1; i < LINE_POINTS; i++) line[i]! += line[i - 1]!;
  return {
    modelId: m.id,
    model: m.primaryModel,
    sessionTokens: n(session.t),
    allTokens: all,
    week: week.inputUncached + week.cacheRead + week.cacheWrite + week.output,
    since: first,
    last: typeof last === "number" ? last : null,
    decodeTps: week.decodeTps,
    prefillTps: week.prefillTps,
    meanTtftMs: week.meanTtftMs,
    cacheHit: week.cacheHit,
    errorRate: ratio(n(day24.e), n(day24.c)),
    line,
  };
};
