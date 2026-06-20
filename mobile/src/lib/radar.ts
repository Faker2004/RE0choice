import type { RadarItem, RadarParams, RadarResult } from "../types";
import {
  anchorEndLabel,
  barOpenBjForTarget,
  addHoursBj,
  MA_BARS,
  resolveLiveOpenBj,
} from "./timezone";
import {
  getPoolSymbols,
  initAndCategorizeInstruments,
  poolLabel,
} from "./instruments";
import { fetchRangeForAnchor, fetchTickerMap } from "./okx";
import {
  prefetchPoolInBackground,
  syncMarketDataWithIncremental,
} from "./syncMarketData";
import { thresholdsForSymbol } from "./thresholdPrefs";
import { computeRadarItemsInWorker } from "./radarWorkerClient";
import { tryBuildRadarFromCloud } from "./cloudRadar";

export {
  DEFAULT_CRYPTO_MIN_CURRENT,
  DEFAULT_CRYPTO_MIN_MA,
  DEFAULT_STOCK_MIN_CURRENT,
  DEFAULT_STOCK_MIN_MA,
} from "./thresholdPrefs";

/** @deprecated 使用 DEFAULT_CRYPTO_MIN_CURRENT */
export const DEFAULT_MIN_CURRENT_VOL = 1_000_000;
/** @deprecated 使用 DEFAULT_CRYPTO_MIN_MA */
export const DEFAULT_MIN_MA_VOL = 500_000;

export type ScanProgress = {
  phase: "symbols" | "syncing" | "computing" | "done";
  done: number;
  total: number;
  cacheHits: number;
  cacheBarHits: number;
  fetchedBars?: number;
  incrementalHits?: number;
};

export async function buildRadar(
  params: RadarParams,
  onProgress?: (p: ScanProgress) => void,
): Promise<RadarResult> {
  const {
    direction,
    thresholds,
    anchor,
    pool = "crypto",
    limit = 50,
    forceFetch = false,
  } = params;
  const dirKey = direction === "down" ? "down" : "up";

  let tOpenBj: string;
  let anchorDisplay: string;
  const live = anchor.mode === "live";

  if (live) {
    tOpenBj = resolveLiveOpenBj();
    anchorDisplay = addHoursBj(tOpenBj, 1).slice(0, 16);
  } else {
    tOpenBj = barOpenBjForTarget(anchor.date, anchor.hour);
    anchorDisplay = anchorEndLabel(anchor.date, anchor.hour);
  }

  const { startBj, endBj } = fetchRangeForAnchor(tOpenBj);

  if (live && !forceFetch) {
    const cloudResult = await tryBuildRadarFromCloud(params, onProgress);
    if (cloudResult) return cloudResult;
  }

  onProgress?.({ phase: "symbols", done: 0, total: 0, cacheHits: 0, cacheBarHits: 0 });

  const [categorized, tickers] = await Promise.all([
    initAndCategorizeInstruments(forceFetch),
    fetchTickerMap(),
  ]);

  const activeSymbols = getPoolSymbols(categorized, pool);
  const inactivePool = pool === "crypto" ? "us_stock" : "crypto";
  const inactiveSymbols = getPoolSymbols(categorized, inactivePool);
  const stockIds = new Set(categorized.us_stock);

  onProgress?.({
    phase: "syncing",
    done: 0,
    total: activeSymbols.length,
    cacheHits: 0,
    cacheBarHits: 0,
    fetchedBars: 0,
    incrementalHits: 0,
  });

  const syncResult = await syncMarketDataWithIncremental({
    symbols: activeSymbols,
    windowStartBj: startBj,
    windowEndBj: endBj,
    forceFetch,
    concurrency: 12,
    onProgress: (p) => {
      onProgress?.({
        phase: "syncing",
        done: p.done,
        total: p.total,
        cacheHits: p.cacheHits,
        cacheBarHits: p.cacheBarHits,
        fetchedBars: p.fetchedBars,
        incrementalHits: p.incrementalHits,
      });
    },
  });

  onProgress?.({
    phase: "computing",
    done: 0,
    total: syncResult.loaded.length,
    cacheHits: syncResult.cacheHits,
    cacheBarHits: syncResult.cacheBarHits,
    fetchedBars: syncResult.fetchedBars,
    incrementalHits: syncResult.incrementalHits,
  });

  const calcJobs = syncResult.loaded.map(({ sym, rows }) => {
    const { minCurrentVol, minMaVol } = thresholdsForSymbol(sym, stockIds, thresholds);
    return {
      symbol: sym,
      klines: rows,
      tOpenBj,
      anchorDisplay,
      minCurrentVol,
      minMaVol,
      ticker: tickers[sym],
      live,
      dirKey: dirKey as "up" | "down",
    };
  });

  const rowsOut = await computeRadarItemsInWorker(calcJobs, dirKey as "up" | "down");

  if (dirKey === "down") {
    rowsOut.sort((a, b) => a.ratioPct - b.ratioPct);
  } else {
    rowsOut.sort((a, b) => b.ratioPct - a.ratioPct);
  }

  onProgress?.({
    phase: "done",
    done: activeSymbols.length,
    total: activeSymbols.length,
    cacheHits: syncResult.cacheHits,
    cacheBarHits: syncResult.cacheBarHits,
    fetchedBars: syncResult.fetchedBars,
    incrementalHits: syncResult.incrementalHits,
  });

  if (!forceFetch && inactiveSymbols.length) {
    prefetchPoolInBackground(inactiveSymbols, startBj, endBj);
  }

  return {
    direction: dirKey,
    directionLabel: dirKey === "up" ? "爆增" : "爆减",
    pool,
    poolLabel: poolLabel(pool),
    live,
    anchorTime: anchorDisplay,
    anchorLabel: live
      ? `T = 最新已收盘 1h K 线 · MA${MA_BARS}(T-1..T-${MA_BARS})`
      : `精准锚定 ${anchorDisplay}（北京时间）· MA${MA_BARS}(T-1..T-${MA_BARS})`,
    scanned: activeSymbols.length,
    matched: rowsOut.length,
    cacheHits: syncResult.cacheHits,
    fetchedBars: syncResult.fetchedBars,
    fromCache: syncResult.cacheHits === activeSymbols.length,
    items: rowsOut.slice(0, limit) as RadarItem[],
  };
}

export { syncMarketDataWithIncremental } from "./syncMarketData";
