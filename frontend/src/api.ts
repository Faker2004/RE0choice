import type { AnchorQuery, PriceWindow, RadarResponse, SurgeDirection } from "./types";

export function bjDateStr(offsetDays = 0): string {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60_000);
  bj.setDate(bj.getDate() + offsetDays);
  const y = bj.getFullYear();
  const m = String(bj.getMonth() + 1).padStart(2, "0");
  const d = String(bj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export async function fetchRadar(
  direction: SurgeDirection,
  anchor: AnchorQuery,
  opts: {
    minCurrentVol?: number;
    minMaVol?: number;
    limit?: number;
    refresh?: boolean;
  } = {},
): Promise<RadarResponse> {
  const params = new URLSearchParams({ direction });
  if (anchor.mode === "history") {
    params.set("date", anchor.date);
    params.set("hour", String(anchor.hour));
  }
  if (opts.minCurrentVol != null) params.set("min_current_vol", String(opts.minCurrentVol));
  if (opts.minMaVol != null) params.set("min_ma_vol", String(opts.minMaVol));
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.refresh) params.set("refresh", "true");

  const res = await fetch(`/api/radar?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || res.statusText);
  }
  return res.json();
}

export function pickPriceChg(
  row: { chg24hPct: number | null; chgTodayPct: number | null },
  window: PriceWindow,
): number | null {
  return window === "24h" ? row.chg24hPct : row.chgTodayPct;
}
