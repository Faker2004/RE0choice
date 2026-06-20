import type { InstrumentPool } from "../types";

const STORAGE_KEY = "re0choice.pool.v1";

export function loadPoolPrefs(): InstrumentPool {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "us_stock" || v === "crypto") return v;
  } catch {
    // ignore
  }
  return "crypto";
}

export function savePoolPrefs(pool: InstrumentPool): void {
  try {
    localStorage.setItem(STORAGE_KEY, pool);
  } catch {
    // ignore
  }
}
