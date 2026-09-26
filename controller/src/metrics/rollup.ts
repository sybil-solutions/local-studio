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

export const card = (db: Database, m: RunningModel, day: (ts: number) => string): ModelCardStats => {
  const now = Date.now();
  const base = "model = ? AND via = 'local'";
  const sumSince = (from: number) => n(db.query<AggRow, [string, number]>(`SELECT SUM(total) AS t FROM requests WHERE ${base} AND ts_start >= ?`).get(m.primaryModel, from)?.t);
  const span = db.query<AggRow, [string]>(`SELECT MIN(ts_start) AS a, MAX(ts_end) AS b, SUM(total) AS t FROM requests WHERE ${base}`).get(m.primaryModel) ?? {};
  const week = sliceOf("7d", db.query<AggRow, [string, number]>(`SELECT ${AGG} FROM requests WHERE ${base} AND ts_start >= ?`).get(m.primaryModel, now - 7 * DAY_MS) ?? {});
  const day24 = db
    .query<AggRow, [string, number]>(`SELECT COUNT(*) AS c, SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS e FROM requests WHERE ${base} AND ts_start >= ?`)
    .get(m.primaryModel, now - DAY_MS) ?? {};
  const line = new Array<number>(LINE_POINTS).fill(0);
  const a = typeof span.a === "number" ? span.a : null;
  const b = typeof span.b === "number" ? span.b : null;
  if (a !== null && b !== null) {
    const width = Math.max(1, b - a + 1);
    const buckets = db
      .query<AggRow, [number, number, number, string]>(
        `SELECT MIN(?, CAST((ts_start - ?) * ${LINE_POINTS} / ? AS INTEGER)) AS k, SUM(total) AS t FROM requests WHERE ${base} GROUP BY k`,
      )
      .all(LINE_POINTS - 1, a, width, m.primaryModel);
    for (const r of buckets) line[Math.max(0, Math.min(LINE_POINTS - 1, n(r.k)))]! += n(r.t);
    for (let i = 1; i < LINE_POINTS; i++) line[i]! += line[i - 1]!;
  }
  return {
    modelId: m.id,
    model: m.primaryModel,
    sessionTokens: sumSince(m.startedAt ?? 0),
    allTokens: n(span.t),
    week: week.inputUncached + week.cacheRead + week.cacheWrite + week.output,
    since: a === null ? null : day(a),
    last: b,
    decodeTps: week.decodeTps,
    prefillTps: week.prefillTps,
    meanTtftMs: week.meanTtftMs,
    cacheHit: week.cacheHit,
    errorRate: ratio(n(day24.e), n(day24.c)),
    line,
  };
};
