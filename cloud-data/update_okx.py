#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub Actions 每小时增量更新 OKX 1h K 线快照 → cloud-data/data.json

- 加密货币池 + 美股衍生池（instCategory / groupId 动态识别）
- 每合约保持精确 25 根 K 线（追加最新、剔除最老）
- 冷启动合约自动 bootstrap 25 根
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx

OKX_BASE = "https://www.okx.com/api/v5"
BAR_COUNT = 25
CONCURRENCY = 16
REQUEST_DELAY = 0.04

UTC8 = timezone(timedelta(hours=8))

OKX_INST_CRYPTO = "1"
OKX_INST_STOCKS = "3"
OKX_INST_COMMODITIES = "4"
OKX_INST_FOREX = "5"
OKX_INST_BONDS = "6"
OKX_SWAP_GROUP_STOCK = "6"

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data.json"


def normalize_bj_hour(raw: str) -> str:
    s = raw.strip().replace("T", " ")
    parts = s.split()
    if len(parts) >= 2:
        date_part, time_part = parts[0], parts[1]
        h = time_part.split(":")[0]
        y, m, d = date_part.split("-")
        return f"{y}-{m}-{d} {h.zfill(2)}:00:00"
    date_part = parts[0]
    y, m, d = date_part.split("-")
    return f"{y}-{m}-{d} 00:00:00"


def utc_ms_to_bj_key(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(UTC8)
    return normalize_bj_hour(dt.strftime("%Y-%m-%d %H:%M:%S"))


def parse_candle(inst_id: str, row: list) -> dict[str, Any]:
    ts_ms = int(row[0])
    return {
        "t": utc_ms_to_bj_key(ts_ms),
        "o": float(row[1]),
        "h": float(row[2]),
        "l": float(row[3]),
        "c": float(row[4]),
        "v": float(row[5]) if row[5] else 0.0,
        "turn": float(row[7]) if len(row) > 7 and row[7] else 0.0,
    }


def bar_to_kline_row(inst_id: str, bar: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": inst_id,
        "timestamp_bj": bar["t"],
        "open": bar["o"],
        "high": bar["h"],
        "low": bar["l"],
        "close": bar["c"],
        "volume": bar["v"],
        "turnover": bar["turn"],
    }


def classify_instrument(row: dict) -> str | None:
    inst_id = row.get("instId", "")
    if not inst_id.endswith("-USDT-SWAP") or row.get("state") != "live":
        return None
    cat = str(row.get("instCategory") or "").strip()
    group = str(row.get("groupId") or "").strip()
    if cat == OKX_INST_STOCKS or group == OKX_SWAP_GROUP_STOCK:
        return "us_stock"
    if cat == OKX_INST_CRYPTO:
        return "crypto"
    if cat in (OKX_INST_COMMODITIES, OKX_INST_FOREX, OKX_INST_BONDS):
        return None
    if cat == "":
        return "us_stock" if group == OKX_SWAP_GROUP_STOCK else "crypto"
    return None


async def okx_get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict:
    for attempt in range(4):
        try:
            resp = await client.get(f"{OKX_BASE}{path}", params=params, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != "0":
                raise ValueError(data.get("msg", "OKX error"))
            return data
        except Exception:
            if attempt == 3:
                raise
            await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError("unreachable")


async def fetch_instruments(client: httpx.AsyncClient) -> tuple[list[str], list[str]]:
    data = await okx_get(client, "/public/instruments", {"instType": "SWAP"})
    crypto: list[str] = []
    us_stock: list[str] = []
    for row in data.get("data") or []:
        pool = classify_instrument(row)
        inst = row.get("instId", "")
        if pool == "crypto":
            crypto.append(inst)
        elif pool == "us_stock":
            us_stock.append(inst)
    crypto.sort()
    us_stock.sort()
    return crypto, us_stock


async def fetch_ticker_map(client: httpx.AsyncClient) -> dict[str, dict]:
    data = await okx_get(client, "/market/tickers", {"instType": "SWAP"})
    out: dict[str, dict] = {}
    for row in data.get("data") or []:
        inst = row.get("instId", "")
        if not inst.endswith("-USDT-SWAP"):
            continue
        last = float(row.get("last") or 0)
        open24h = float(row.get("open24h") or 0)
        sod8 = float(row.get("sodUtc8") or 0)
        sod0 = float(row.get("sodUtc0") or 0)
        today_open = sod8 if sod8 > 0 else sod0

        def pct(base: float) -> float | None:
            if base <= 0 or last <= 0:
                return None
            return round((last - base) / base * 100, 2)

        out[inst] = {
            "chg24hPct": pct(open24h),
            "chgTodayPct": pct(today_open),
        }
    return out


async def fetch_latest_candles(
    client: httpx.AsyncClient,
    inst_id: str,
    limit: int = 1,
) -> list[dict[str, Any]]:
    data = await okx_get(
        client,
        "/market/candles",
        {"instId": inst_id, "bar": "1H", "limit": str(min(max(limit, 1), 300))},
    )
    rows = [parse_candle(inst_id, r) for r in (data.get("data") or [])]
    rows.sort(key=lambda x: x["t"])
    return rows


def load_data() -> dict:
    if not DATA_FILE.exists():
        return {
            "version": 1,
            "barCount": BAR_COUNT,
            "updatedAt": None,
            "pools": {"crypto": [], "us_stock": []},
            "tickers": {},
            "klines": {},
        }
    with DATA_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_data(payload: dict) -> None:
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def upsert_bars(existing: list[dict], new_bars: list[dict], max_bars: int = BAR_COUNT) -> list[dict]:
    by_ts = {b["t"]: b for b in existing}
    for bar in new_bars:
        by_ts[bar["t"]] = bar
    merged = sorted(by_ts.values(), key=lambda x: x["t"])
    if len(merged) > max_bars:
        merged = merged[-max_bars:]
    return merged


async def update_symbol(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    inst_id: str,
    store: dict,
    stats: dict,
) -> None:
    async with sem:
        try:
            existing = store["klines"].get(inst_id, [])
            if len(existing) < BAR_COUNT:
                fetched = await fetch_latest_candles(client, inst_id, limit=BAR_COUNT)
                stats["bootstrap"] += 1
            else:
                fetched = await fetch_latest_candles(client, inst_id, limit=1)
                stats["incremental"] += 1
            if fetched:
                store["klines"][inst_id] = upsert_bars(existing, fetched, BAR_COUNT)
                stats["ok"] += 1
            else:
                stats["empty"] += 1
        except Exception as exc:
            stats["fail"] += 1
            print(f"[WARN] {inst_id}: {exc}", file=sys.stderr)
        finally:
            await asyncio.sleep(REQUEST_DELAY)


async def main() -> None:
    store = load_data()
    stats = {"ok": 0, "fail": 0, "empty": 0, "bootstrap": 0, "incremental": 0}

    async with httpx.AsyncClient(http2=False) as client:
        crypto, us_stock = await fetch_instruments(client)
        store["pools"] = {"crypto": crypto, "us_stock": us_stock}

        tickers = await fetch_ticker_map(client)
        all_symbols = crypto + us_stock
        store["tickers"] = {k: v for k, v in tickers.items() if k in set(all_symbols)}

        sem = asyncio.Semaphore(CONCURRENCY)
        tasks = [update_symbol(client, sem, sym, store, stats) for sym in all_symbols]
        await asyncio.gather(*tasks)

    now_bj = datetime.now(UTC8).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    store["version"] = 1
    store["barCount"] = BAR_COUNT
    store["updatedAt"] = now_bj

    save_data(store)

    print(
        f"Done: {stats['ok']} ok, {stats['fail']} fail, "
        f"bootstrap={stats['bootstrap']}, incremental={stats['incremental']}, "
        f"crypto={len(crypto)}, us_stock={len(us_stock)}, updatedAt={now_bj}"
    )


if __name__ == "__main__":
    asyncio.run(main())
