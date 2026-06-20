import type { RadarParams, RadarResult } from "../types";
import { addHoursBj, MA_BARS, resolveLiveOpenBj } from "./timezone";
import { poolLabel } from "./instruments";
import { thresholdsForSymbol } from "./thresholdPrefs";
import { computeRadarItemsInWorker } from "./radarWorkerClient";
import type { ScanProgress } from "./radar";
import {
  cloudBarToRows,
  fetchCloudSnapshot,
  getCloudPoolSymbols,
  hydrateCloudToIndexedDb,
  isCloudSnapshotFresh,
  type CloudSnapshot,
} from "./cloudData";

export async function tryBuildRadarFromCloud(
  params: RadarParams,
  onProgress?: (p: ScanProgress) => void,
): Promise<RadarResult | null> {
  const { direction, thresholds, pool = "crypto", limit = 50, forceFetch } = params;

  if (forceFetch || params.anchor.mode !== "live") {
    return null;
  }

  onProgress?.({ phase: "symbols", done: 0, total: 0, cacheHits: 0, cacheBarHits: 0 });

  const snapshot = await fetchCloudSnapshot();
  if (!snapshot || !isCloudSnapshotFresh(snapshot)) {
    return null;
  }

  const dirKey = direction === "down" ? "down" : "up";
  const tOpenBj = resolveLiveOpenBj();
  const anchorDisplay = addHoursBj(tOpenBj, 1).slice(0, 16);
  const symbols = getCloudPoolSymbols(snapshot, pool);
  const stockIds = new Set(snapshot.pools.us_stock ?? []);

  onProgress?.({
    phase: "computing",
    done: 0,
    total: symbols.length,
    cacheHits: symbols.length,
    cacheBarHits: symbols.length * (snapshot.barCount ?? 25),
  });

  const calcJobs = symbols
    .map((sym) => {
      const bars = snapshot.klines[sym];
      if (!bars?.length) return null;
      const { minCurrentVol, minMaVol } = thresholdsForSymbol(sym, stockIds, thresholds);
      return {
        symbol: sym,
        klines: cloudBarToRows(sym, bars),
        tOpenBj,
        anchorDisplay,
        minCurrentVol,
        minMaVol,
        ticker: snapshot.tickers[sym],
        live: true,
        dirKey: dirKey as "up" | "down",
      };
    })
    .filter(Boolean) as Parameters<typeof computeRadarItemsInWorker>[0];

  const rowsOut = await computeRadarItemsInWorker(calcJobs, dirKey);

  if (dirKey === "down") {
    rowsOut.sort((a, b) => a.ratioPct - b.ratioPct);
  } else {
    rowsOut.sort((a, b) => b.ratioPct - a.ratioPct);
  }

  onProgress?.({
    phase: "done",
    done: symbols.length,
    total: symbols.length,
    cacheHits: symbols.length,
    cacheBarHits: symbols.length * (snapshot.barCount ?? 25),
    fetchedBars: 0,
    incrementalHits: 0,
  });

  void hydrateCloudToIndexedDb(snapshot);

  return {
    direction: dirKey,
    directionLabel: dirKey === "up" ? "爆增" : "爆减",
    pool,
    poolLabel: poolLabel(pool),
    live: true,
    anchorTime: anchorDisplay,
    anchorLabel: `云端快照 · T = 最新已收盘 1h K 线 · MA${MA_BARS}(T-1..T-${MA_BARS})`,
    scanned: symbols.length,
    matched: rowsOut.length,
    cacheHits: symbols.length,
    fetchedBars: 0,
    fromCache: true,
    fromCloud: true,
    items: rowsOut.slice(0, limit),
  };
}

export type { CloudSnapshot };
