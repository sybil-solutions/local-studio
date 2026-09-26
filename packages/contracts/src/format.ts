export const k = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 1e6) return `${trim(n / 1e3)}K`;
  if (a < 1e9) return `${trim(n / 1e6)}M`;
  return `${trim(n / 1e9)}B`;
};

const trim = (x: number): string => {
  const s = Math.abs(x) >= 100 ? String(Math.round(x)) : x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

export const tps = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const v = Math.max(0, n);
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
};

export const gb = (mib: number | null | undefined): string => {
  if (mib === null || mib === undefined) return "–";
  const g = mib / 1024;
  return g >= 10 ? `${Math.round(g)} GB` : `${g.toFixed(1)} GB`;
};

export const ctx = (tokens: number | null | undefined): string =>
  tokens === null || tokens === undefined ? "–" : `${Math.round(tokens / 1024)}K`;

export const ms = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "–";
  if (v < 1000) return `${Math.round(v)} ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, "0")}s`;
};

export const dur = (seconds: number): string => {
  if (seconds < 3600) return `${Math.max(0, Math.floor(seconds / 60))}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}h`;
};

export const ago = (tsMs: number, now = Date.now()): string => {
  const s = (now - tsMs) / 1000;
  if (s < 300) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const cacheHitPercent = (hit: number, total: number): string | null => {
  if (!(total > 0)) return null;
  if (hit >= total) return "100";
  for (let decimals = 0; decimals <= 6; decimals++) {
    const scale = 10 ** decimals;
    const scaled = Math.floor((hit * 100 * scale * 2 + total) / (2 * total));
    if (scaled < 100 * scale) return decimals === 0 ? String(scaled) : (scaled / scale).toFixed(decimals);
  }
  return (100 - 1e-6).toFixed(6);
};

export const pct = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`;
