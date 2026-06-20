import { clearDb, getDb } from "./klineDb";

export type CacheReport = {
  bars: number;
  symbols: number;
  /** 浏览器/WebView 报告的本源已用空间（含 IndexedDB） */
  usageBytes: number;
  quotaBytes: number;
  dbName: string;
};

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

export { fmtBytes };

export async function getCacheReport(): Promise<CacheReport> {
  const db = await getDb();
  const bars = await db.count("klines");

  const symbols = new Set<string>();
  const tx = db.transaction("klines", "readonly");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    symbols.add(cursor.value.symbol);
    cursor = await cursor.continue();
  }
  await tx.done;

  let usageBytes = 0;
  let quotaBytes = 0;
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? 0;
      quotaBytes = est.quota ?? 0;
    } catch {
      // ignore
    }
  }

  return {
    bars,
    symbols: symbols.size,
    usageBytes,
    quotaBytes,
    dbName: "re0choice-radar",
  };
}

export async function clearAllCache(): Promise<void> {
  await clearDb();
}

export function formatCacheSummary(r: CacheReport): string {
  const parts = [`${r.bars.toLocaleString()} 条 K 线`, `${r.symbols} 合约`];
  if (r.usageBytes > 0) {
    parts.push(`占用 ${fmtBytes(r.usageBytes)}`);
    if (r.quotaBytes > 0) {
      parts.push(`配额 ${fmtBytes(r.quotaBytes)}`);
    }
  }
  return parts.join(" · ");
}
