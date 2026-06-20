import type { KlineRow } from "../types";
import {
  addHoursBj,
  enumerateBjHours,
  expectedBarCount,
  normalizeBjHour,
} from "./timezone";
import {
  getKlinesRange,
  getSymbolLatestBj,
  probeSymbolCache,
  putKlinesImmediate,
  trimSymbolOutsideWindow,
  type ProbeResult,
} from "./klineDb";
import { mapPool, pullHistoryCandles, pullLatestCandles } from "./okx";

export type SymbolSyncMeta = {
  sym: string;
  rows: KlineRow[];
  fullyCached: boolean;
  barHitCount: number;
  fetchedBars: number;
  networkRequests: number;
  mode: "cached" | "incremental" | "cold" | "gap_fill";
};

export type SyncProgress = {
  done: number;
  total: number;
  cacheHits: number;
  cacheBarHits: number;
  fetchedBars: number;
  incrementalHits: number;
};

export type SyncResult = {
  loaded: SymbolSyncMeta[];
  cacheHits: number;
  cacheBarHits: number;
  fetchedBars: number;
  incrementalHits: number;
};

/**
 * 单合约增量补单：
 * - 窗口全命中 → 零网络
 * - 仅有尾部缺口 → limit=N 拉最新 K 线（通常 1~3 根）
 * - 冷启动 / 中间缺口 → 只拉缺失区间
 */
export async function syncSymbolIncremental(
  symbol: string,
  windowStartBj: string,
  windowEndBj: string,
  forceFetch = false,
): Promise<Omit<SymbolSyncMeta, "sym">> {
  const start = normalizeBjHour(windowStartBj);
  const end = normalizeBjHour(windowEndBj);
  const requiredHours = enumerateBjHours(start, end);
  const requiredCount = requiredHours.length;

  let probe: ProbeResult;
  if (forceFetch) {
    probe = { hits: [], misses: [...requiredHours], barHitCount: 0, fullyCached: false };
  } else {
    probe = await probeSymbolCache(symbol, requiredHours);
  }

  if (probe.fullyCached) {
    return {
      rows: probe.hits,
      fullyCached: true,
      barHitCount: probe.barHitCount,
      fetchedBars: 0,
      networkRequests: 0,
      mode: "cached",
    };
  }

  let mode: SymbolSyncMeta["mode"] = "gap_fill";
  let fetchedBars = 0;
  let networkRequests = 0;

  const latestCached = probe.hits.length
    ? probe.hits[probe.hits.length - 1].timestamp_bj
    : await getSymbolLatestBj(symbol);

  const onlyTailGap =
    latestCached &&
    probe.misses.length > 0 &&
    probe.misses.every((m) => m > latestCached!) &&
    probe.hits.length >= requiredCount * 0.85;

  if (!forceFetch && onlyTailGap) {
    mode = "incremental";
    const gapCount = probe.misses.length;
    const limit = Math.min(Math.max(gapCount + 1, 3), 300);
    const pulled = await pullLatestCandles(symbol, limit);
    networkRequests = 1;

    const missSet = new Set(probe.misses);
    const toWrite = pulled.filter((r) => {
      const ts = normalizeBjHour(r.timestamp_bj);
      return ts >= start && ts <= end && missSet.has(ts);
    });
    fetchedBars = toWrite.length ? await putKlinesImmediate(toWrite) : 0;
  } else if (!probe.hits.length && !latestCached) {
    mode = "cold";
    const pulled = await pullHistoryCandles(symbol, start, end);
    networkRequests = 1;
    const toWrite = pulled.filter((r) => {
      const ts = normalizeBjHour(r.timestamp_bj);
      return ts >= start && ts <= end;
    });
    fetchedBars = toWrite.length ? await putKlinesImmediate(toWrite) : 0;
  } else {
    const fetchStart = probe.misses[0] ?? start;
    const fetchEnd = probe.misses[probe.misses.length - 1] ?? end;
    const pulled = await pullHistoryCandles(symbol, fetchStart, fetchEnd);
    networkRequests = 1;
    const missSet = new Set(probe.misses);
    const toWrite = pulled.filter((r) => {
      const ts = normalizeBjHour(r.timestamp_bj);
      return ts >= start && ts <= end && missSet.has(ts);
    });
    fetchedBars = toWrite.length ? await putKlinesImmediate(toWrite) : 0;
  }

  await trimSymbolOutsideWindow(symbol, start, end);

  const rows = await getKlinesRange(symbol, start, end);
  const rowSet = new Set(rows.map((r) => r.timestamp_bj));
  const stillMissing = requiredHours.filter((h) => !rowSet.has(h));

  return {
    rows,
    fullyCached: stillMissing.length === 0 && rows.length >= requiredCount,
    barHitCount: probe.barHitCount,
    fetchedBars,
    networkRequests,
    mode,
  };
}

export type SyncMarketOptions = {
  symbols: string[];
  windowStartBj: string;
  windowEndBj: string;
  forceFetch?: boolean;
  /** 并发网络/sync 数；活跃池建议 12+ */
  concurrency?: number;
  onProgress?: (p: SyncProgress) => void;
};

/**
 * 多合约并行增量补单（IndexedDB 滑动窗口 + 尾部 limit 拉取）。
 */
export async function syncMarketDataWithIncremental(
  opts: SyncMarketOptions,
): Promise<SyncResult> {
  const {
    symbols,
    windowStartBj,
    windowEndBj,
    forceFetch = false,
    concurrency = 12,
    onProgress,
  } = opts;

  let cacheHits = 0;
  let cacheBarHits = 0;
  let fetchedBars = 0;
  let incrementalHits = 0;
  let done = 0;

  const loaded = await mapPool(symbols, concurrency, async (sym) => {
    const meta = await syncSymbolIncremental(sym, windowStartBj, windowEndBj, forceFetch);
    done++;
    cacheBarHits += meta.barHitCount;
    if (meta.fullyCached) cacheHits++;
    fetchedBars += meta.fetchedBars;
    if (meta.mode === "incremental") incrementalHits++;

    onProgress?.({
      done,
      total: symbols.length,
      cacheHits,
      cacheBarHits,
      fetchedBars,
      incrementalHits,
    });

    return { sym, ...meta };
  });

  return {
    loaded,
    cacheHits,
    cacheBarHits,
    fetchedBars,
    incrementalHits,
  };
}

/** 后台预热非激活池（不阻塞 UI） */
let bgSyncToken = 0;

export function prefetchPoolInBackground(
  symbols: string[],
  windowStartBj: string,
  windowEndBj: string,
): void {
  if (!symbols.length) return;
  const token = ++bgSyncToken;
  void syncMarketDataWithIncremental({
    symbols,
    windowStartBj,
    windowEndBj,
    concurrency: 4,
  }).then(() => {
    if (token !== bgSyncToken) return;
  });
}

export function windowBarCount(windowStartBj: string, windowEndBj: string): number {
  return expectedBarCount(windowStartBj, windowEndBj);
}

export { addHoursBj };
