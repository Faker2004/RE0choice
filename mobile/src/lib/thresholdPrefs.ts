import type { InstrumentPool } from "../types";

export const DEFAULT_CRYPTO_MIN_CURRENT = 1_000_000;
export const DEFAULT_CRYPTO_MIN_MA = 500_000;
export const DEFAULT_STOCK_MIN_CURRENT = 50_000;
export const DEFAULT_STOCK_MIN_MA = 20_000;

const STORAGE_KEY = "re0choice.thresholds.v1";

export type PoolThresholds = {
  minCurrentVol: number;
  minMaVol: number;
};

export type ThresholdConfig = {
  crypto: PoolThresholds;
  us_stock: PoolThresholds;
};

export type SavedThresholdStrings = {
  crypto_min_current: string;
  crypto_min_ma: string;
  stock_min_current: string;
  stock_min_ma: string;
};

function clampVol(n: number): number {
  return Math.max(0, Number.isFinite(n) ? n : 0);
}

export function loadThresholdStrings(): SavedThresholdStrings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SavedThresholdStrings>;
      return {
        crypto_min_current: String(p.crypto_min_current ?? DEFAULT_CRYPTO_MIN_CURRENT),
        crypto_min_ma: String(p.crypto_min_ma ?? DEFAULT_CRYPTO_MIN_MA),
        stock_min_current: String(p.stock_min_current ?? DEFAULT_STOCK_MIN_CURRENT),
        stock_min_ma: String(p.stock_min_ma ?? DEFAULT_STOCK_MIN_MA),
      };
    }
  } catch {
    // ignore
  }
  return {
    crypto_min_current: String(DEFAULT_CRYPTO_MIN_CURRENT),
    crypto_min_ma: String(DEFAULT_CRYPTO_MIN_MA),
    stock_min_current: String(DEFAULT_STOCK_MIN_CURRENT),
    stock_min_ma: String(DEFAULT_STOCK_MIN_MA),
  };
}

export function saveThresholdStrings(prefs: SavedThresholdStrings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function stringsToThresholdConfig(s: SavedThresholdStrings): ThresholdConfig {
  return {
    crypto: {
      minCurrentVol: clampVol(Number(s.crypto_min_current)),
      minMaVol: clampVol(Number(s.crypto_min_ma)),
    },
    us_stock: {
      minCurrentVol: clampVol(Number(s.stock_min_current)),
      minMaVol: clampVol(Number(s.stock_min_ma)),
    },
  };
}

export function thresholdsForPool(pool: InstrumentPool, cfg: ThresholdConfig): PoolThresholds {
  return pool === "us_stock" ? cfg.us_stock : cfg.crypto;
}

export function thresholdsForSymbol(
  instId: string,
  stockIds: ReadonlySet<string>,
  cfg: ThresholdConfig,
): PoolThresholds {
  return stockIds.has(instId) ? cfg.us_stock : cfg.crypto;
}
