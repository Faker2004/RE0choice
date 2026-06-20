# -*- coding: utf-8 -*-
"""成交额暴增/爆减雷达 — 滑动窗口均比计算。"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx

from database import UTC8, bj_hour_str, init_db, normalize_bj_hour, parse_bj_hour
from okx_client import ensure_symbol_klines, fetch_ticker_map, list_usdt_swaps

MA_BARS = 24
DEFAULT_MIN_CURRENT_VOL = 1_000_000
DEFAULT_MIN_MA_VOL = 500_000
CACHE_TTL = 120

_result_cache: dict[str, tuple[float, dict]] = {}


def short_symbol(inst_id: str) -> str:
    return inst_id.replace("-USDT-SWAP", "")


def _pct_change(last: float, base: float) -> float | None:
    if base <= 0 or last <= 0:
        return None
    return round((last - base) / base * 100, 2)


def bar_open_for_target(calendar_day, target_hour: int) -> datetime:
    """
    锚定结算小时 T（如 11:00）→ 分子 K 线 open 时间（10:00 北京时间）。
  T=0 表示当日 00:00 结束，对应前一日 23:00~00:00 这根 K 线。
    """
    if target_hour <= 0:
        prev = calendar_day - timedelta(days=1)
        return datetime(prev.year, prev.month, prev.day, 23, 0, 0, tzinfo=UTC8)
    return datetime(
        calendar_day.year,
        calendar_day.month,
        calendar_day.day,
        target_hour - 1,
        0,
        0,
        tzinfo=UTC8,
    )


def anchor_end_label(calendar_day, target_hour: int) -> str:
    if target_hour <= 0:
        return datetime(
            calendar_day.year, calendar_day.month, calendar_day.day, 0, 0, 0, tzinfo=UTC8
        ).strftime("%Y-%m-%d %H:00")
    return datetime(
        calendar_day.year,
        calendar_day.month,
        calendar_day.day,
        target_hour,
        0,
        0,
        tzinfo=UTC8,
    ).strftime("%Y-%m-%d %H:00")


def _index_by_ts(klines: list[dict], ts_bj: str) -> int | None:
    key = normalize_bj_hour(ts_bj)
    for i, k in enumerate(klines):
        if normalize_bj_hour(k["timestamp_bj"]) == key:
            return i
    return None


def _ratio_at_t(klines: list[dict], t_idx: int, ma_bars: int = MA_BARS) -> tuple[float, float, float] | None:
    """Ratio = (Current_Vol / MA_24_Vol) - 1；klines 为北京时间升序。"""
    if t_idx < ma_bars:
        return None
    hist = [float(klines[i]["turnover"]) for i in range(t_idx - ma_bars, t_idx)]
    if len(hist) < ma_bars:
        return None
    ma_vol = sum(hist) / ma_bars
    current_vol = float(klines[t_idx]["turnover"])
    if ma_vol <= 0 or current_vol <= 0:
        return None
    ratio_pct = (current_vol / ma_vol - 1) * 100
    return current_vol, ma_vol, ratio_pct


def _price_from_klines(klines: list[dict], t_idx: int) -> tuple[float | None, float | None]:
    """从升序 K 线推算 24h 涨幅与今日涨幅（UTC+8 日界）。"""
    if t_idx >= len(klines):
        return None, None
    close_t = float(klines[t_idx]["close"])
    chg24h = None
    if t_idx >= MA_BARS:
        close_24h = float(klines[t_idx - MA_BARS]["close"])
        chg24h = _pct_change(close_t, close_24h)

    anchor_day = parse_bj_hour(klines[t_idx]["timestamp_bj"]).date()
    day_open_idx = t_idx
    for j in range(t_idx, -1, -1):
        day = parse_bj_hour(klines[j]["timestamp_bj"]).date()
        if day != anchor_day:
            break
        day_open_idx = j
    chg_today = _pct_change(close_t, float(klines[day_open_idx]["close"]))
    return chg24h, chg_today


def _calc_row(
    symbol: str,
    klines: list[dict],
    t_open_bj: datetime,
    *,
    anchor_display: str,
    min_current_vol: float,
    min_ma_vol: float,
    ticker: dict | None,
    live: bool,
) -> dict | None:
    ts_key = bj_hour_str(t_open_bj)
    t_idx = _index_by_ts(klines, ts_key)
    if t_idx is None:
        return None

    scored = _ratio_at_t(klines, t_idx)
    if scored is None:
        return None
    current_vol, ma_vol, ratio_pct = scored
    if current_vol < min_current_vol or ma_vol < min_ma_vol:
        return None

    if live and ticker:
        chg24h = ticker.get("chg24hPct")
        chg_today = ticker.get("chgTodayPct")
    else:
        chg24h, chg_today = _price_from_klines(klines, t_idx)
        if ticker:
            if chg24h is None:
                chg24h = ticker.get("chg24hPct")
            if chg_today is None:
                chg_today = ticker.get("chgTodayPct")

    k = klines[t_idx]
    return {
        "instId": symbol,
        "symbol": short_symbol(symbol),
        "timeLabel": k["timestamp_bj"][:16],
        "latestVol": round(current_vol, 2),
        "avgVol": round(ma_vol, 2),
        "ratioPct": round(ratio_pct, 2),
        "chg24hPct": chg24h,
        "chgTodayPct": chg_today,
        "klineTime": anchor_display,
    }


def _resolve_live_open(now_bj: datetime | None = None) -> datetime:
    """实时模式：取最近一根已收盘 1h K 线的 open（北京时间）。"""
    now = now_bj or datetime.now(UTC8)
    floored = now.replace(minute=0, second=0, microsecond=0)
    return floored - timedelta(hours=1)


async def build_radar(
    *,
    direction: str = "up",
    min_current_vol: float = DEFAULT_MIN_CURRENT_VOL,
    min_ma_vol: float = DEFAULT_MIN_MA_VOL,
    date: str | None = None,
    hour: int | None = None,
    limit: int = 50,
    refresh: bool = False,
) -> dict:
    init_db()
    limit = max(5, min(limit, 200))
    dir_key = "down" if direction == "down" else "up"

    live = date is None
    if live:
        now_bj = datetime.now(UTC8)
        t_open = _resolve_live_open(now_bj)
        anchor_display = (t_open + timedelta(hours=1)).strftime("%Y-%m-%d %H:00")
    else:
        y, m, d = int(date[0:4]), int(date[5:7]), int(date[8:10])
        cal_day = datetime(y, m, d).date()
        th = 0 if hour is None else int(hour)
        t_open = bar_open_for_target(cal_day, th)
        anchor_display = anchor_end_label(cal_day, th)

    # 需要 T 及 T-1..T-24 共 25 根；额外多取 24 根用于 24h 涨幅
    fetch_start = t_open - timedelta(hours=MA_BARS * 2)
    fetch_end = t_open

    cache_key = (
        f"{dir_key}:{min_current_vol}:{min_ma_vol}:{date}:{hour}:{limit}:"
        f"{bj_hour_str(fetch_start)}:{bj_hour_str(fetch_end)}"
    )
    now = time.time()
    if not refresh and cache_key in _result_cache:
        ts, payload = _result_cache[cache_key]
        if now - ts < CACHE_TTL:
            out = dict(payload)
            out["fromCache"] = True
            out["cacheAgeSec"] = int(now - ts)
            return out

    sem = asyncio.Semaphore(10)
    cache_hits = 0
    cache_bar_hits = 0
    fetched_bars = 0

    async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
        symbols, tickers = await asyncio.gather(
            list_usdt_swaps(client),
            fetch_ticker_map(client),
        )

        async def _load(sym: str) -> tuple[str, list[dict], dict]:
            async with sem:
                rows, meta = await ensure_symbol_klines(
                    client, sym, fetch_start, fetch_end, force_fetch=refresh
                )
                return sym, rows, meta

        loaded = await asyncio.gather(*[_load(s) for s in symbols])

    rows_out: list[dict] = []
    for sym, klines, meta in loaded:
        if meta.get("fullyCached"):
            cache_hits += 1
        cache_bar_hits += meta.get("barHitCount", 0)
        fetched_bars += meta.get("fetchedBars", 0)
        item = _calc_row(
            sym,
            klines,
            t_open,
            anchor_display=anchor_display,
            min_current_vol=min_current_vol,
            min_ma_vol=min_ma_vol,
            ticker=tickers.get(sym),
            live=live,
        )
        if item is None:
            continue
        ratio = item["ratioPct"]
        if dir_key == "up" and ratio <= 0:
            continue
        if dir_key == "down" and ratio >= 0:
            continue
        rows_out.append(item)

    if dir_key == "down":
        rows_out.sort(key=lambda r: r["ratioPct"])
    else:
        rows_out.sort(key=lambda r: r["ratioPct"], reverse=True)

    top = rows_out[:limit]
    payload = {
        "direction": dir_key,
        "directionLabel": "爆增" if dir_key == "up" else "爆减",
        "live": live,
        "anchorTime": anchor_display,
        "anchorLabel": (
            f"精准锚定 {anchor_display}（北京时间）· MA{MA_BARS}(T-1..T-{MA_BARS})"
            if not live
            else f"T = 最新已收盘 1h K 线 · MA{MA_BARS}(T-1..T-{MA_BARS})"
        ),
        "minCurrentVol": min_current_vol,
        "minMaVol": min_ma_vol,
        "scanned": len(symbols),
        "matched": len(rows_out),
        "filtered": len(top),
        "cacheHits": cache_hits,
        "cacheBarHits": cache_bar_hits,
        "fetchedBars": fetched_bars,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "items": top,
        "fromCache": cache_hits == len(symbols),
        "cacheAgeSec": 0,
    }
    _result_cache[cache_key] = (now, payload)
    return payload


def clear_result_cache() -> dict:
    n = len(_result_cache)
    _result_cache.clear()
    return {"entries": n}
