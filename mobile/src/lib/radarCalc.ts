import type { KlineRow } from "../types";
import { MA_BARS, normalizeBjHour } from "./timezone";

export type TickerCalcInfo = {
  chg24hPct: number | null;
  chgTodayPct: number | null;
};

export type CalcRowInput = {
  symbol: string;
  klines: KlineRow[];
  tOpenBj: string;
  anchorDisplay: string;
  minCurrentVol: number;
  minMaVol: number;
  ticker?: TickerCalcInfo;
  live: boolean;
};

export type CalcRowOutput = {
  instId: string;
  symbol: string;
  latestVol: number;
  avgVol: number;
  ratioPct: number;
  chg24hPct: number | null;
  chgTodayPct: number | null;
  klineTime: string;
} | null;

function shortSymbol(instId: string): string {
  return instId.replace("-USDT-SWAP", "");
}

function pctChange(last: number, base: number): number | null {
  if (base <= 0 || last <= 0) return null;
  return Math.round(((last - base) / base) * 10000) / 100;
}

function indexByTs(klines: KlineRow[], tsBj: string): number | null {
  const key = normalizeBjHour(tsBj);
  const i = klines.findIndex((k) => k.timestamp_bj === key);
  return i >= 0 ? i : null;
}

function ratioAtT(klines: KlineRow[], tIdx: number): [number, number, number] | null {
  if (tIdx < MA_BARS) return null;
  const hist = klines.slice(tIdx - MA_BARS, tIdx).map((k) => k.turnover);
  if (hist.length < MA_BARS) return null;
  const maVol = hist.reduce((a, b) => a + b, 0) / MA_BARS;
  const currentVol = klines[tIdx].turnover;
  if (maVol <= 0 || currentVol <= 0) return null;
  const ratioPct = (currentVol / maVol - 1) * 100;
  return [currentVol, maVol, ratioPct];
}

function priceFromKlines(
  klines: KlineRow[],
  tIdx: number,
): { chg24h: number | null; chgToday: number | null } {
  const closeT = klines[tIdx].close;
  let chg24h: number | null = null;
  if (tIdx >= MA_BARS) {
    chg24h = pctChange(closeT, klines[tIdx - MA_BARS].close);
  }

  const anchorDay = klines[tIdx].timestamp_bj.slice(0, 10);
  let dayOpenIdx = tIdx;
  for (let j = tIdx; j >= 0; j--) {
    if (klines[j].timestamp_bj.slice(0, 10) !== anchorDay) break;
    dayOpenIdx = j;
  }
  const chgToday = pctChange(closeT, klines[dayOpenIdx].close);
  return { chg24h, chgToday };
}

/** 纯函数：滑动窗口均比 + 门槛过滤（不含方向筛选） */
export function calcRadarRow(input: CalcRowInput): CalcRowOutput {
  const {
    symbol,
    klines,
    tOpenBj,
    anchorDisplay,
    minCurrentVol,
    minMaVol,
    ticker,
    live,
  } = input;

  const tIdx = indexByTs(klines, tOpenBj);
  if (tIdx === null) return null;

  const scored = ratioAtT(klines, tIdx);
  if (!scored) return null;
  const [currentVol, maVol, ratioPct] = scored;
  if (currentVol < minCurrentVol || maVol < minMaVol) return null;

  let chg24hPct: number | null = null;
  let chgTodayPct: number | null = null;

  if (live && ticker) {
    chg24hPct = ticker.chg24hPct;
    chgTodayPct = ticker.chgTodayPct;
  } else {
    const px = priceFromKlines(klines, tIdx);
    chg24hPct = px.chg24h ?? ticker?.chg24hPct ?? null;
    chgTodayPct = px.chgToday ?? ticker?.chgTodayPct ?? null;
  }

  return {
    instId: symbol,
    symbol: shortSymbol(symbol),
    latestVol: Math.round(currentVol * 100) / 100,
    avgVol: Math.round(maVol * 100) / 100,
    ratioPct: Math.round(ratioPct * 100) / 100,
    chg24hPct,
    chgTodayPct,
    klineTime: anchorDisplay,
  };
}

export type BatchCalcPayload = {
  jobs: Array<
    CalcRowInput & {
      dirKey: "up" | "down";
    }
  >;
};

export type BatchCalcResult = {
  items: NonNullable<CalcRowOutput>[];
};

/** Worker / 主线程共用：批量计算并应用爆增/爆减方向过滤 */
export function batchCalcRadarRows(payload: BatchCalcPayload): BatchCalcResult {
  const items: NonNullable<CalcRowOutput>[] = [];
  for (const job of payload.jobs) {
    const row = calcRadarRow(job);
    if (!row) continue;
    if (job.dirKey === "up" && row.ratioPct <= 0) continue;
    if (job.dirKey === "down" && row.ratioPct >= 0) continue;
    items.push(row);
  }
  return { items };
}
