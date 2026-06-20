# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import clear_db, db_stats, init_db
from radar_engine import (
    DEFAULT_MIN_CURRENT_VOL,
    DEFAULT_MIN_MA_VOL,
    build_radar,
    clear_result_cache,
)

# 服务重启时清空内存榜缓存，避免旧逻辑结果残留
clear_result_cache()
init_db()

app = FastAPI(title="OKX Volume Radar API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "RE0choice-radar"}


@app.get("/api/radar")
async def radar(
    direction: str = Query("up", description="up 爆增 / down 爆减"),
    min_current_vol: float = Query(DEFAULT_MIN_CURRENT_VOL, ge=0),
    min_ma_vol: float = Query(DEFAULT_MIN_MA_VOL, ge=0),
    date: str | None = Query(None, description="锚定日期 YYYY-MM-DD（北京时间），空=实时"),
    hour: int | None = Query(None, ge=0, le=23, description="锚定小时 0-23（北京时间）"),
    limit: int = Query(50, ge=5, le=200),
    refresh: bool = Query(False),
):
    if direction not in ("up", "down"):
        raise HTTPException(400, "direction 仅支持 up 或 down")
    if date is not None and (len(date) != 10 or date[4] != "-" or date[7] != "-"):
        raise HTTPException(400, "date 格式应为 YYYY-MM-DD")
    if date is None and hour is not None:
        raise HTTPException(400, "实时模式无需指定 hour")
    try:
        return await build_radar(
            direction=direction,
            min_current_vol=min_current_vol,
            min_ma_vol=min_ma_vol,
            date=date,
            hour=hour,
            limit=limit,
            refresh=refresh,
        )
    except Exception as e:
        raise HTTPException(502, f"雷达计算失败: {e}") from e


@app.get("/api/cache/info")
async def cache_info():
    from radar_engine import _result_cache

    return {
        "database": db_stats(),
        "memoryEntries": len(_result_cache),
    }


@app.post("/api/cache/clear")
async def cache_clear():
    db = clear_db()
    mem = clear_result_cache()
    return {"ok": True, "database": db, "memory": mem}


def _mount_frontend() -> None:
    if not FRONTEND_DIST.is_dir():
        return
    assets = FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/")
    async def index():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        file = FRONTEND_DIST / path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")


_mount_frontend()
