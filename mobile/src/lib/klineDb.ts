import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { KlineRow } from "../types";
import { normalizeBjHour } from "./timezone";

interface RadarDB extends DBSchema {
  klines: {
    key: [string, string];
    value: KlineRow;
    indexes: { by_symbol: string };
  };
}

const DB_NAME = "re0choice-radar";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<RadarDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<RadarDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("klines", {
            keyPath: ["symbol", "timestamp_bj"],
          });
          store.createIndex("by_symbol", "symbol");
        }
        if (oldVersion < 2 && db.objectStoreNames.contains("klines")) {
          // v2: 逻辑升级，结构不变；旧数据保留
        }
      },
    });
  }
  return dbPromise;
}

export function makeKlineKey(symbol: string, timestampBj: string): [string, string] {
  return [symbol, normalizeBjHour(timestampBj)];
}

/** 单条 get — 碰撞检查核心 */
export async function getKline(
  symbol: string,
  timestampBj: string,
): Promise<KlineRow | undefined> {
  const db = await getDb();
  const key = makeKlineKey(symbol, timestampBj);
  const row = await db.get("klines", key);
  return row ?? undefined;
}

/** 单条立刻写入硬盘（readwrite 事务） */
export async function putKlineImmediate(row: KlineRow): Promise<void> {
  const db = await getDb();
  const normalized: KlineRow = {
    ...row,
    timestamp_bj: normalizeBjHour(row.timestamp_bj),
  };
  const tx = db.transaction("klines", "readwrite");
  await tx.store.put(normalized);
  await tx.done;
}

/** 批量立刻写入，每条 put 后等待事务完成 */
export async function putKlinesImmediate(rows: KlineRow[]): Promise<number> {
  if (!rows.length) return 0;
  const db = await getDb();
  const tx = db.transaction("klines", "readwrite");
  let n = 0;
  for (const raw of rows) {
    const row: KlineRow = { ...raw, timestamp_bj: normalizeBjHour(raw.timestamp_bj) };
    await tx.store.put(row);
    n++;
  }
  await tx.done;
  return n;
}

export type ProbeResult = {
  hits: KlineRow[];
  misses: string[];
  barHitCount: number;
  fullyCached: boolean;
};

/**
 * 区间一次读取（替代逐条 get，大幅加速碰撞）。
 */
export async function probeSymbolCache(
  symbol: string,
  requiredHours: string[],
): Promise<ProbeResult> {
  if (!requiredHours.length) {
    return { hits: [], misses: [], barHitCount: 0, fullyCached: true };
  }

  const normalized = requiredHours.map((h) => normalizeBjHour(h));
  const start = normalized[0];
  const end = normalized[normalized.length - 1];
  const hits = await getKlinesRange(symbol, start, end);
  const hitSet = new Set(hits.map((k) => k.timestamp_bj));
  const misses = normalized.filter((h) => !hitSet.has(h));

  hits.sort((a, b) => a.timestamp_bj.localeCompare(b.timestamp_bj));
  return {
    hits,
    misses,
    barHitCount: hits.length,
    fullyCached: misses.length === 0,
  };
}

/** 该合约本地最新一根 K 线（北京时间 Key） */
export async function getSymbolLatestBj(symbol: string): Promise<string | null> {
  const db = await getDb();
  const all = await db.getAllFromIndex("klines", "by_symbol", symbol);
  if (!all.length) return null;
  let max = all[0].timestamp_bj;
  for (const row of all) {
    if (row.timestamp_bj > max) max = row.timestamp_bj;
  }
  return max;
}

/** 剔除窗口外历史，保持 IndexedDB 滑动窗口紧凑 */
export async function trimSymbolOutsideWindow(
  symbol: string,
  startBj: string,
  endBj: string,
): Promise<number> {
  const start = normalizeBjHour(startBj);
  const end = normalizeBjHour(endBj);
  const db = await getDb();
  const all = await db.getAllFromIndex("klines", "by_symbol", symbol);
  const toDelete = all.filter((r) => r.timestamp_bj < start || r.timestamp_bj > end);
  if (!toDelete.length) return 0;

  const tx = db.transaction("klines", "readwrite");
  for (const row of toDelete) {
    await tx.store.delete([symbol, row.timestamp_bj]);
  }
  await tx.done;
  return toDelete.length;
}

export async function getKlinesRange(
  symbol: string,
  startBj: string,
  endBj: string,
): Promise<KlineRow[]> {
  const start = normalizeBjHour(startBj);
  const end = normalizeBjHour(endBj);
  const db = await getDb();
  const all = await db.getAllFromIndex("klines", "by_symbol", symbol);
  return all
    .filter((k) => k.timestamp_bj >= start && k.timestamp_bj <= end)
    .sort((a, b) => a.timestamp_bj.localeCompare(b.timestamp_bj));
}

export async function dbStats(): Promise<{ bars: number; symbols: number }> {
  const db = await getDb();
  const all = await db.getAll("klines");
  const symbols = new Set(all.map((k) => k.symbol));
  return { bars: all.length, symbols: symbols.size };
}

export async function clearDb(): Promise<void> {
  const db = await getDb();
  await db.clear("klines");
}
