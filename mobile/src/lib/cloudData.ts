import type { InstrumentPool, KlineRow } from "../types";
import { CLOUD_DATA_URL, CLOUD_MAX_AGE_MINUTES } from "./cloudConfig";
import { putKlinesImmediate } from "./klineDb";

export type CloudTicker = {
  chg24hPct: number | null;
  chgTodayPct: number | null;
};

/** 紧凑 K 线 bar（与 Python data.json 一致） */
type CloudBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  turn: number;
};

export type CloudSnapshot = {
  version: number;
  barCount: number;
  updatedAt: string | null;
  pools: Record<InstrumentPool, string[]>;
  tickers: Record<string, CloudTicker>;
  klines: Record<string, CloudBar[]>;
};

let memoryCache: { snapshot: CloudSnapshot; fetchedAt: number } | null = null;
const MEMORY_TTL_MS = 60_000;

function barToRow(instId: string, bar: CloudBar): KlineRow {
  return {
    symbol: instId,
    timestamp_bj: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    turnover: bar.turn,
  };
}

export function cloudBarToRows(instId: string, bars: CloudBar[]): KlineRow[] {
  return bars.map((b) => barToRow(instId, b)).sort((a, b) => a.timestamp_bj.localeCompare(b.timestamp_bj));
}

export function isCloudSnapshotFresh(snapshot: CloudSnapshot): boolean {
  if (!snapshot.updatedAt) return false;
  const ts = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(ts)) return false;
  const ageMin = (Date.now() - ts) / 60_000;
  return ageMin <= CLOUD_MAX_AGE_MINUTES;
}

export async function fetchCloudSnapshot(force = false): Promise<CloudSnapshot | null> {
  if (
    !force &&
    memoryCache &&
    Date.now() - memoryCache.fetchedAt < MEMORY_TTL_MS
  ) {
    return memoryCache.snapshot;
  }

  if (!CLOUD_DATA_URL || CLOUD_DATA_URL.includes("YOUR_USER")) {
    return null;
  }

  try {
    const resp = await fetch(CLOUD_DATA_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const snapshot = (await resp.json()) as CloudSnapshot;
    if (!snapshot?.klines || !snapshot?.pools) return null;
    memoryCache = { snapshot, fetchedAt: Date.now() };
    return snapshot;
  } catch {
    return null;
  }
}

/** 后台写入 IndexedDB，供离线/历史锚定使用 */
export async function hydrateCloudToIndexedDb(snapshot: CloudSnapshot): Promise<number> {
  const rows: KlineRow[] = [];
  for (const [instId, bars] of Object.entries(snapshot.klines)) {
    rows.push(...cloudBarToRows(instId, bars));
  }
  if (!rows.length) return 0;
  return putKlinesImmediate(rows);
}

export function getCloudPoolSymbols(snapshot: CloudSnapshot, pool: InstrumentPool): string[] {
  return pool === "us_stock" ? snapshot.pools.us_stock ?? [] : snapshot.pools.crypto ?? [];
}
