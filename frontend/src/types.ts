export type SurgeDirection = "up" | "down";
export type PriceWindow = "24h" | "today";

export interface RadarItem {
  instId: string;
  symbol: string;
  timeLabel: string;
  latestVol: number;
  avgVol: number;
  ratioPct: number;
  chg24hPct: number | null;
  chgTodayPct: number | null;
  klineTime: string;
}

export interface RadarResponse {
  direction: SurgeDirection;
  directionLabel: string;
  live: boolean;
  anchorTime: string;
  anchorLabel: string;
  minCurrentVol: number;
  minMaVol: number;
  scanned: number;
  matched: number;
  filtered: number;
  cacheHits: number;
  cacheBarHits?: number;
  fetchedBars: number;
  updatedAt: string;
  items: RadarItem[];
  fromCache: boolean;
  cacheAgeSec: number;
}

export type AnchorQuery =
  | { mode: "live" }
  | { mode: "history"; date: string; hour: number };
