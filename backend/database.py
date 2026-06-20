# -*- coding: utf-8 -*-
"""SQLite 增量 K 线仓库 — market_data.db 位于项目根目录。"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator, TypedDict

UTC8 = timezone(timedelta(hours=8))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "market_data.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS klines (
    symbol      TEXT NOT NULL,
    timestamp_bj  TEXT NOT NULL,
    open          REAL NOT NULL,
    high          REAL NOT NULL,
    low           REAL NOT NULL,
    close         REAL NOT NULL,
    volume        REAL NOT NULL,
    turnover      REAL NOT NULL,
    PRIMARY KEY (symbol, timestamp_bj)
);
CREATE INDEX IF NOT EXISTS idx_klines_symbol_ts ON klines(symbol, timestamp_bj);
"""


class ProbeResult(TypedDict):
    hits: list[dict]
    misses: list[str]
    bar_hit_count: int
    fully_cached: bool


def normalize_bj_hour(raw: str) -> str:
    """统一 Key：YYYY-MM-DD HH:00:00"""
    s = raw.strip().replace("T", " ")
    date_part, _, tail = s.partition(" ")
    y, m, d = date_part.split("-")
    h = int(tail[:2]) if tail else 0
    return f"{y}-{m}-{d} {h:02d}:00:00"


def bj_hour_str(dt: datetime) -> str:
    """北京时间整点 open 标签 YYYY-MM-DD HH:00:00。"""
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC8)
    else:
        dt = dt.replace(tzinfo=UTC8)
    return dt.strftime("%Y-%m-%d %H:00:00")


def parse_bj_hour(s: str) -> datetime:
    return datetime.strptime(normalize_bj_hour(s), "%Y-%m-%d %H:00:00").replace(tzinfo=UTC8)


def enumerate_bj_hours(start_bj: datetime, end_bj: datetime) -> list[str]:
    """升序枚举 [start, end] 闭区间每个整点 Key。"""
    if start_bj.tzinfo is None:
        start_bj = start_bj.replace(tzinfo=UTC8)
    else:
        start_bj = start_bj.astimezone(UTC8)
    if end_bj.tzinfo is None:
        end_bj = end_bj.replace(tzinfo=UTC8)
    else:
        end_bj = end_bj.astimezone(UTC8)

    cur = start_bj.replace(minute=0, second=0, microsecond=0)
    end = end_bj.replace(minute=0, second=0, microsecond=0)
    out: list[str] = []
    guard = 0
    while cur <= end and guard < 500:
        out.append(bj_hour_str(cur))
        if cur >= end:
            break
        cur += timedelta(hours=1)
        guard += 1
    return out


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(_SCHEMA)


def get_kline(symbol: str, timestamp_bj: str) -> dict | None:
    """单条主键碰撞查询。"""
    ts = normalize_bj_hour(timestamp_bj)
    with get_conn() as conn:
        cur = conn.execute(
            """
            SELECT symbol, timestamp_bj, open, high, low, close, volume, turnover
            FROM klines WHERE symbol = ? AND timestamp_bj = ?
            """,
            (symbol, ts),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def probe_symbol_cache(symbol: str, required_hours: list[str]) -> ProbeResult:
    """批量碰撞：返回 hits / misses / bar_hit_count。"""
    hours = [normalize_bj_hour(h) for h in required_hours]
    if not hours:
        return {"hits": [], "misses": [], "bar_hit_count": 0, "fully_cached": True}

    placeholders = ",".join("?" * len(hours))
    with get_conn() as conn:
        cur = conn.execute(
            f"""
            SELECT symbol, timestamp_bj, open, high, low, close, volume, turnover
            FROM klines
            WHERE symbol = ? AND timestamp_bj IN ({placeholders})
            """,
            [symbol, *hours],
        )
        found = {normalize_bj_hour(r["timestamp_bj"]): dict(r) for r in cur.fetchall()}

    hits = [found[h] for h in hours if h in found]
    misses = [h for h in hours if h not in found]
    return {
        "hits": hits,
        "misses": misses,
        "bar_hit_count": len(hits),
        "fully_cached": len(misses) == 0,
    }


def insert_klines(rows: list[dict]) -> int:
    if not rows:
        return 0
    normalized = []
    for r in rows:
        normalized.append({**r, "timestamp_bj": normalize_bj_hour(r["timestamp_bj"])})
    with get_conn() as conn:
        cur = conn.executemany(
            """
            INSERT OR IGNORE INTO klines
            (symbol, timestamp_bj, open, high, low, close, volume, turnover)
            VALUES (:symbol, :timestamp_bj, :open, :high, :low, :close, :volume, :turnover)
            """,
            normalized,
        )
        return cur.rowcount


def get_klines_range(symbol: str, start_bj: datetime, end_bj: datetime) -> list[dict]:
    """升序返回 [start_bj, end_bj] 闭区间内的 K 线。"""
    start_s = bj_hour_str(start_bj)
    end_s = bj_hour_str(end_bj)
    with get_conn() as conn:
        cur = conn.execute(
            """
            SELECT symbol, timestamp_bj, open, high, low, close, volume, turnover
            FROM klines
            WHERE symbol = ? AND timestamp_bj >= ? AND timestamp_bj <= ?
            ORDER BY timestamp_bj ASC
            """,
            (symbol, start_s, end_s),
        )
        return [dict(r) for r in cur.fetchall()]


def db_stats() -> dict:
    init_db()
    with get_conn() as conn:
        cur = conn.execute("SELECT COUNT(*) AS n, COUNT(DISTINCT symbol) AS syms FROM klines")
        row = cur.fetchone()
        size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return {
        "bars": row["n"],
        "symbols": row["syms"],
        "bytes": size,
        "path": str(DB_PATH),
    }


def clear_db() -> dict:
    init_db()
    with get_conn() as conn:
        cur = conn.execute("SELECT COUNT(*) FROM klines")
        n = cur.fetchone()[0]
        conn.execute("DELETE FROM klines")
    size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return {"deleted": n, "bytes": size, "path": str(DB_PATH)}
