export type SurgeDirection = "up" | "down";
export type PriceWindow = "24h" | "today";
/** 加密货币池 | 美股衍生池 */
export type InstrumentPool = "crypto" | "us_stock";

export interface KlineRow {
  symbol: string;
  timestamp_bj: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface RadarItem {
  instId: string;
  symbol: string;
  latestVol: number;
  avgVol: number;
  ratioPct: number;
  chg24hPct: number | null;
  chgTodayPct: number | null;
  klineTime: string;
}

export interface RadarResult {
  direction: SurgeDirection;
  directionLabel: string;
  pool: InstrumentPool;
  poolLabel: string;
  live: boolean;
  anchorTime: string;
  anchorLabel: string;
  scanned: number;
  matched: number;
  cacheHits: number;
  fetchedBars: number;
  fromCache: boolean;
  /** 来自 GitHub Actions 云端快照 */
  fromCloud?: boolean;
  items: RadarItem[];
}

export type AnchorMode =
  | { mode: "live" }
  | { mode: "history"; date: string; hour: number };

export type PoolThresholds = {
  minCurrentVol: number;
  minMaVol: number;
};

export type ThresholdConfig = {
  crypto: PoolThresholds;
  us_stock: PoolThresholds;
};

export interface RadarParams {
  direction: SurgeDirection;
  anchor: AnchorMode;
  priceWindow: PriceWindow;
  pool?: InstrumentPool;
  /** 两池独立门槛；扫描时按合约所属池自动套用 */
  thresholds: ThresholdConfig;
  limit?: number;
  forceFetch?: boolean;
}
