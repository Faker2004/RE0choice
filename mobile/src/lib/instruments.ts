import { fetchSwapInstruments, type OkxSwapInstrument } from "./okx";
import type { InstrumentPool } from "../types";

/** OKX instCategory：标的资产类别（官方字段） */
export const OKX_INST_CATEGORY = {
  CRYPTO: "1",
  STOCKS: "3",
  COMMODITIES: "4",
  FOREX: "5",
  BONDS: "6",
} as const;

/** 永续 groupId=6：Stock perpetual futures（官方文档） */
export const OKX_SWAP_GROUP_STOCK = "6";

export type CategorizedPools = {
  /** 加密货币 USDT 永续池 */
  crypto: string[];
  /** 美股股票 USDT 永续池 */
  us_stock: string[];
  /** 原始合约详情（调试 / 扩展用） */
  instruments: OkxSwapInstrument[];
  fetchedAt: number;
};

let cachedPools: CategorizedPools | null = null;

/**
 * 单合约分类：优先 OKX instCategory，辅以 groupId。
 * 不使用静态白名单；大宗商品/外汇/债券不进任一池。
 */
export function classifyInstrument(row: OkxSwapInstrument): InstrumentPool | null {
  if (!row.instId.endsWith("-USDT-SWAP") || row.state !== "live") {
    return null;
  }

  const cat = String(row.instCategory ?? "").trim();
  const groupId = String(row.groupId ?? "").trim();

  if (cat === OKX_INST_CATEGORY.STOCKS || groupId === OKX_SWAP_GROUP_STOCK) {
    return "us_stock";
  }
  if (cat === OKX_INST_CATEGORY.CRYPTO) {
    return "crypto";
  }
  if (
    cat === OKX_INST_CATEGORY.COMMODITIES ||
    cat === OKX_INST_CATEGORY.FOREX ||
    cat === OKX_INST_CATEGORY.BONDS
  ) {
    return null;
  }

  // 旧版 API 无 instCategory：USDT 永续默认归入加密，除非 groupId 标明股票
  if (cat === "") {
    return groupId === OKX_SWAP_GROUP_STOCK ? "us_stock" : "crypto";
  }

  return null;
}

export function categorizeInstruments(rows: OkxSwapInstrument[]): CategorizedPools {
  const crypto: string[] = [];
  const us_stock: string[] = [];

  for (const row of rows) {
    const pool = classifyInstrument(row);
    if (pool === "crypto") crypto.push(row.instId);
    else if (pool === "us_stock") us_stock.push(row.instId);
  }

  crypto.sort();
  us_stock.sort();

  return {
    crypto,
    us_stock,
    instruments: rows,
    fetchedAt: Date.now(),
  };
}

/**
 * 拉取全网 SWAP 并按 OKX 官方字段动态分为【加密货币池】与【美股衍生池】。
 */
export async function initAndCategorizeInstruments(
  forceRefresh = false,
): Promise<CategorizedPools> {
  if (cachedPools && !forceRefresh) {
    return cachedPools;
  }
  const rows = await fetchSwapInstruments();
  cachedPools = categorizeInstruments(rows);
  return cachedPools;
}

export function getPoolSymbols(pools: CategorizedPools, pool: InstrumentPool): string[] {
  return pool === "us_stock" ? pools.us_stock : pools.crypto;
}

export function poolLabel(pool: InstrumentPool): string {
  return pool === "us_stock" ? "美股衍生" : "加密货币";
}

export function clearInstrumentCache(): void {
  cachedPools = null;
}
