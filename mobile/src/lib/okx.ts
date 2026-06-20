import type { KlineRow } from "../types";
import {
  addHoursBj,
  bjHourStrFromMs,
  bjMsFromHourStr,
  normalizeBjHour,
} from "./timezone";
import {
  getKline,
  probeSymbolCache,
} from "./klineDb";

const OKX_BASE = "https://www.okx.com/api/v5";
const BAR_MS = 3600_000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(`${OKX_BASE}${path}${qs}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { code: string; msg?: string; data?: unknown };
      if (data.code !== "0") throw new Error(data.msg ?? "OKX error");
      return data as T;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

export type OkxSwapInstrument = {
  instId: string;
  state: string;
  instCategory?: string;
  groupId?: string;
  uly?: string;
  ctVal?: string;
  ctValCcy?: string;
  settleCcy?: string;
  lotSz?: string;
  minSz?: string;
  tickSz?: string;
  expTime?: string;
};

export async function fetchSwapInstruments(): Promise<OkxSwapInstrument[]> {
  const data = await getJson<{ data: OkxSwapInstrument[] }>(
    "/public/instruments",
    { instType: "SWAP" },
  );
  return (data.data ?? []).filter(
    (r) => r.instId.endsWith("-USDT-SWAP") && r.state === "live",
  );
}

/** @deprecated 请使用 initAndCategorizeInstruments + getPoolSymbols */
export async function listUsdtSwaps(): Promise<string[]> {
  const rows = await fetchSwapInstruments();
  return rows.map((r) => r.instId).sort();
}

export interface TickerInfo {
  chg24hPct: number | null;
  chgTodayPct: number | null;
}

function pct(last: number, base: number): number | null {
  if (base <= 0 || last <= 0) return null;
  return Math.round(((last - base) / base) * 10000) / 100;
}

export async function fetchTickerMap(): Promise<Record<string, TickerInfo>> {
  const data = await getJson<{
    data: {
      instId: string;
      last: string;
      open24h: string;
      sodUtc8: string;
      sodUtc0: string;
    }[];
  }>("/market/tickers", { instType: "SWAP" });

  const out: Record<string, TickerInfo> = {};
  for (const row of data.data ?? []) {
    if (!row.instId.endsWith("-USDT-SWAP")) continue;
    const last = Number(row.last) || 0;
    const open24h = Number(row.open24h) || 0;
    const sod8 = Number(row.sodUtc8) || 0;
    const sod0 = Number(row.sodUtc0) || 0;
    const todayOpen = sod8 > 0 ? sod8 : sod0;
    out[row.instId] = {
      chg24hPct: pct(last, open24h),
      chgTodayPct: pct(last, todayOpen),
    };
  }
  return out;
}

function parseCandle(symbol: string, row: string[]): KlineRow {
  const tsMs = Number(row[0]);
  return {
    symbol,
    timestamp_bj: normalizeBjHour(bjHourStrFromMs(tsMs)),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]) || 0,
    turnover: row[7] ? Number(row[7]) : 0,
  };
}

/** 拉取最新 N 根已收盘 1h K 线（增量补单核心，limit 通常 3~5） */
export async function pullLatestCandles(symbol: string, limit: number): Promise<KlineRow[]> {
  const lim = Math.min(Math.max(1, limit), 300);
  const data = await getJson<{ data: string[][] }>("/market/candles", {
    instId: symbol,
    bar: "1H",
    limit: String(lim),
  });
  const rows = (data.data ?? []).map((raw) => parseCandle(symbol, raw));
  rows.sort((a, b) => a.timestamp_bj.localeCompare(b.timestamp_bj));
  return rows;
}

/** 仅拉取缺失区间 [fetchStart, fetchEnd] 的网络 K 线 */
export async function pullHistoryCandles(
  symbol: string,
  fetchStartBj: string,
  fetchEndBj: string,
): Promise<KlineRow[]> {
  const startBj = normalizeBjHour(fetchStartBj);
  const endBj = normalizeBjHour(fetchEndBj);
  const startMs = bjMsFromHourStr(startBj);
  const endMs = bjMsFromHourStr(endBj) + BAR_MS;
  const map = new Map<string, KlineRow>();
  let cursor = endMs;

  while (cursor > startMs) {
    const data = await getJson<{ data: string[][] }>("/market/history-candles", {
      instId: symbol,
      bar: "1H",
      after: String(cursor),
      limit: "300",
    });
    const batch = data.data ?? [];
    if (!batch.length) break;

    for (const raw of batch) {
      const tsMs = Number(raw[0]);
      if (tsMs < startMs) continue;
      const parsed = parseCandle(symbol, raw);
      map.set(parsed.timestamp_bj, parsed);
    }

    const oldest = Number(batch[batch.length - 1][0]);
    if (oldest <= startMs) break;
    cursor = oldest - 1;
    await sleep(55);
  }

  return [...map.values()].sort((a, b) => a.timestamp_bj.localeCompare(b.timestamp_bj));
}

export type EnsureMeta = {
  rows: KlineRow[];
  fullyCached: boolean;
  barHitCount: number;
  fetchedBars: number;
  networkRequests: number;
  mode?: "cached" | "incremental" | "cold" | "gap_fill";
};

/** @deprecated 请使用 syncSymbolIncremental / syncMarketDataWithIncremental */
export async function ensureSymbolKlines(
  symbol: string,
  startBj: string,
  endBj: string,
  forceFetch = false,
): Promise<EnsureMeta> {
  const { syncSymbolIncremental } = await import("./syncMarketData");
  const meta = await syncSymbolIncremental(symbol, startBj, endBj, forceFetch);
  return meta;
}

export function fetchRangeForAnchor(tOpenBj: string): { startBj: string; endBj: string } {
  return {
    startBj: addHoursBj(normalizeBjHour(tOpenBj), -48),
    endBj: normalizeBjHour(tOpenBj),
  };
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// 导出供调试
export { getKline, probeSymbolCache };
