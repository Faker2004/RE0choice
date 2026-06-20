# -*- coding: utf-8 -*-
"""OKX 永续合约 1h K 线拉取（UTC → 北京时间对齐）。"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from database import (
    UTC8,
    bj_hour_str,
    enumerate_bj_hours,
    get_klines_range,
    insert_klines,
    normalize_bj_hour,
    parse_bj_hour,
    probe_symbol_cache,
)

OKX_BASE = "https://www.okx.com/api/v5"
HISTORY_URL = f"{OKX_BASE}/market/history-candles"
BAR_SECONDS = 3600


def utc_ms_to_bj_open(ms: int) -> datetime:
    """OKX K 线时间戳（UTC open）→ 北京时间整点 open。"""
    dt_utc = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    dt_bj = dt_utc.astimezone(UTC8)
    return dt_bj.replace(minute=0, second=0, microsecond=0)


def bj_open_to_utc_ms(dt_bj: datetime) -> int:
    """北京时间整点 open → UTC 毫秒（供 OKX after 参数）。"""
    if dt_bj.tzinfo is None:
        dt_bj = dt_bj.replace(tzinfo=UTC8)
    return int(dt_bj.astimezone(timezone.utc).timestamp() * 1000)


async def _get_json(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict:
    for attempt in range(4):
        try:
            resp = await client.get(f"{OKX_BASE}{path}", params=params)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != "0":
                raise ValueError(data.get("msg", "OKX API error"))
            return data
        except Exception:
            if attempt == 3:
                raise
            await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError("unreachable")


async def list_usdt_swaps(client: httpx.AsyncClient) -> list[str]:
    data = await _get_json(client, "/public/instruments", {"instType": "SWAP"})
    return sorted(
        row["instId"]
        for row in data.get("data") or []
        if row.get("instId", "").endswith("-USDT-SWAP") and row.get("state") == "live"
    )


async def fetch_ticker_map(client: httpx.AsyncClient) -> dict[str, dict]:
    data = await _get_json(client, "/market/tickers", {"instType": "SWAP"})
    out: dict[str, dict] = {}
    for row in data.get("data") or []:
        inst = row.get("instId", "")
        if not inst.endswith("-USDT-SWAP"):
            continue
        try:
            last = float(row.get("last") or 0)
            open24h = float(row.get("open24h") or 0)
            sod_utc8 = float(row.get("sodUtc8") or 0)
            sod_utc0 = float(row.get("sodUtc0") or 0)
            today_open = sod_utc8 if sod_utc8 > 0 else sod_utc0
            out[inst] = {
                "last": last,
                "chg24hPct": _pct(last, open24h),
                "chgTodayPct": _pct(last, today_open),
            }
        except (TypeError, ValueError):
            out[inst] = {"last": 0.0, "chg24hPct": None, "chgTodayPct": None}
    return out


def _pct(last: float, base: float) -> float | None:
    if base <= 0 or last <= 0:
        return None
    return round((last - base) / base * 100, 2)


def _parse_candle_row(symbol: str, row: list) -> dict:
    ts_ms = int(row[0])
    dt_bj = utc_ms_to_bj_open(ts_ms)
    return {
        "symbol": symbol,
        "timestamp_bj": normalize_bj_hour(bj_hour_str(dt_bj)),
        "open": float(row[1]),
        "high": float(row[2]),
        "low": float(row[3]),
        "close": float(row[4]),
        "volume": float(row[5]) if row[5] else 0.0,
        "turnover": float(row[7]) if len(row) > 7 and row[7] else 0.0,
    }


async def pull_history_candles(
    client: httpx.AsyncClient,
    symbol: str,
    start_bj: datetime,
    end_bj: datetime,
) -> list[dict]:
    """从 OKX 拉取 [start_bj, end_bj] 区间 1h K 线，时间已转北京时间。"""
    start_ms = bj_open_to_utc_ms(start_bj)
    end_ms = bj_open_to_utc_ms(end_bj) + BAR_SECONDS * 1000
    rows: dict[str, dict] = {}
    cursor = end_ms

    while cursor > start_ms:
        params = {
            "instId": symbol,
            "bar": "1H",
            "after": str(cursor),
            "limit": "300",
        }
        for attempt in range(5):
            try:
                resp = await client.get(HISTORY_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception:
                if attempt == 4:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
        else:
            break

        if data.get("code") != "0":
            raise ValueError(data.get("msg", "OKX API error"))

        batch = data.get("data") or []
        if not batch:
            break

        for raw in batch:
            ts_ms = int(raw[0])
            if ts_ms < start_ms:
                continue
            parsed = _parse_candle_row(symbol, raw)
            rows[parsed["timestamp_bj"]] = parsed

        oldest = int(batch[-1][0])
        if oldest <= start_ms:
            break
        cursor = oldest - 1
        await asyncio.sleep(0.05)

    return sorted(rows.values(), key=lambda x: x["timestamp_bj"])


async def ensure_symbol_klines(
    client: httpx.AsyncClient,
    symbol: str,
    start_bj: datetime,
    end_bj: datetime,
    *,
    force_fetch: bool = False,
) -> tuple[list[dict], dict]:
    """
    逐条 Key 碰撞 SQLite → 仅补缺失区间 → 立刻 INSERT。
    返回 (升序 K 线, meta)。
    """
    required = enumerate_bj_hours(start_bj, end_bj)
    start_s = normalize_bj_hour(bj_hour_str(start_bj))
    end_s = normalize_bj_hour(bj_hour_str(end_bj))

    if force_fetch:
        probe = {"hits": [], "misses": required, "bar_hit_count": 0, "fully_cached": False}
    else:
        probe = probe_symbol_cache(symbol, required)

    if probe["fully_cached"]:
        return probe["hits"], {
            "fromCache": True,
            "fullyCached": True,
            "barHitCount": probe["bar_hit_count"],
            "fetchedBars": 0,
        }

    fetch_start = parse_bj_hour(probe["misses"][0])
    fetch_end = parse_bj_hour(probe["misses"][-1])
    miss_set = set(probe["misses"])

    pulled = await pull_history_candles(client, symbol, fetch_start, fetch_end)
    to_write = [
        r
        for r in pulled
        if normalize_bj_hour(r["timestamp_bj"]) in miss_set
        and start_s <= normalize_bj_hour(r["timestamp_bj"]) <= end_s
    ]
    fetched = insert_klines(to_write) if to_write else 0

    after = probe_symbol_cache(symbol, required)
    return after["hits"], {
        "fromCache": after["fully_cached"],
        "fullyCached": after["fully_cached"],
        "barHitCount": probe["bar_hit_count"],
        "fetchedBars": fetched,
    }
