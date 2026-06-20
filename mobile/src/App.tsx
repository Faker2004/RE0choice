import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRadar, type ScanProgress } from "./lib/radar";
import { bjDateStr } from "./lib/timezone";
import { fmtPct, fmtUsd } from "./lib/format";
import type { AnchorMode, InstrumentPool, PriceWindow, RadarResult, SurgeDirection } from "./types";
import { initialAnchorState, saveAnchorPrefs } from "./lib/anchorPrefs";
import { loadPoolPrefs, savePoolPrefs } from "./lib/poolPrefs";
import {
  loadThresholdStrings,
  saveThresholdStrings,
  stringsToThresholdConfig,
} from "./lib/thresholdPrefs";
import { CachePanel } from "./components/CachePanel";
import { clearInstrumentCache } from "./lib/instruments";
import { FilterDrawer } from "./components/FilterDrawer";
import "./App.css";

const _initAnchor = initialAnchorState();
const _initThresholds = loadThresholdStrings();

function pickChg(row: { chg24hPct: number | null; chgTodayPct: number | null }, w: PriceWindow) {
  return w === "24h" ? row.chg24hPct : row.chgTodayPct;
}

function anchorStatusText(anchor: AnchorMode): string {
  if (anchor.mode === "live") return "实时";
  const d = anchor.date.replace(/-/g, "/");
  return `${d} ${String(anchor.hour).padStart(2, "0")}:00`;
}

export default function App() {
  const [direction, setDirection] = useState<SurgeDirection>("up");
  const [priceWindow, setPriceWindow] = useState<PriceWindow>("24h");
  const [cryptoMinCurrent, setCryptoMinCurrent] = useState(_initThresholds.crypto_min_current);
  const [cryptoMinMa, setCryptoMinMa] = useState(_initThresholds.crypto_min_ma);
  const [stockMinCurrent, setStockMinCurrent] = useState(_initThresholds.stock_min_current);
  const [stockMinMa, setStockMinMa] = useState(_initThresholds.stock_min_ma);
  const [anchor, setAnchor] = useState<AnchorMode>(_initAnchor.anchor);
  const [anchorDate, setAnchorDate] = useState(
    () => _initAnchor.anchorDate || bjDateStr(-1),
  );
  const [anchorHour, setAnchorHour] = useState(_initAnchor.anchorHour);
  const [data, setData] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [instrumentPool, setInstrumentPool] = useState<InstrumentPool>(loadPoolPrefs);
  const seqRef = useRef(0);

  const thresholdStrings = useMemo(
    () => ({
      crypto_min_current: cryptoMinCurrent,
      crypto_min_ma: cryptoMinMa,
      stock_min_current: stockMinCurrent,
      stock_min_ma: stockMinMa,
    }),
    [cryptoMinCurrent, cryptoMinMa, stockMinCurrent, stockMinMa],
  );

  const thresholdConfig = useMemo(
    () => stringsToThresholdConfig(thresholdStrings),
    [thresholdStrings],
  );

  const activeMinCurrent =
    instrumentPool === "crypto" ? cryptoMinCurrent : stockMinCurrent;
  const activeMinMa = instrumentPool === "crypto" ? cryptoMinMa : stockMinMa;

  const persistThresholds = (next: {
    crypto_min_current?: string;
    crypto_min_ma?: string;
    stock_min_current?: string;
    stock_min_ma?: string;
  }) => {
    saveThresholdStrings({ ...thresholdStrings, ...next });
  };

  const onMinCurrentChange = (v: string) => {
    if (instrumentPool === "crypto") {
      setCryptoMinCurrent(v);
      persistThresholds({ crypto_min_current: v });
    } else {
      setStockMinCurrent(v);
      persistThresholds({ stock_min_current: v });
    }
  };

  const onMinMaChange = (v: string) => {
    if (instrumentPool === "crypto") {
      setCryptoMinMa(v);
      persistThresholds({ crypto_min_ma: v });
    } else {
      setStockMinMa(v);
      persistThresholds({ stock_min_ma: v });
    }
  };

  const runScan = useCallback(
    async (anchorSnap: AnchorMode, forceFetch = false) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");
      setProgress(null);
      try {
        const res = await buildRadar(
          {
            direction,
            thresholds: thresholdConfig,
            anchor: anchorSnap,
            priceWindow,
            pool: instrumentPool,
            limit: 50,
            forceFetch,
          },
          (p) => {
            if (seq === seqRef.current) setProgress(p);
          },
        );
        if (seq !== seqRef.current) return;
        setData(res);
      } catch (e) {
        if (seq !== seqRef.current) return;
        setError(e instanceof Error ? e.message : "扫描失败");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [direction, thresholdConfig, priceWindow, instrumentPool],
  );

  useEffect(() => {
    runScan(anchor);
  }, [direction, instrumentPool]);

  const applyHistory = () => {
    const next: AnchorMode = { mode: "history", date: anchorDate, hour: anchorHour };
    setAnchor(next);
    saveAnchorPrefs({ mode: "history", date: anchorDate, hour: anchorHour });
    runScan(next);
  };

  const pickLive = () => {
    setAnchor({ mode: "live" });
    saveAnchorPrefs({ mode: "live", date: anchorDate, hour: anchorHour });
    runScan({ mode: "live" });
  };

  const onAnchorDateChange = (date: string) => {
    setAnchorDate(date);
    saveAnchorPrefs({ mode: anchor.mode, date, hour: anchorHour });
  };

  const onAnchorHourChange = (hour: number) => {
    setAnchorHour(hour);
    saveAnchorPrefs({ mode: anchor.mode, date: anchorDate, hour });
  };

  const pctCls = (v: number | null | undefined) =>
    typeof v === "number" ? (v >= 0 ? "up" : "down") : "";

  const dirLabel = direction === "up" ? "爆增" : "爆减";
  const priceLabel = priceWindow === "24h" ? "24H涨幅" : "今日涨幅";
  const chgColLabel = priceWindow === "24h" ? "24H涨幅" : "今日涨幅";
  const poolName = instrumentPool === "us_stock" ? "美股衍生" : "加密货币";
  const thresholdPoolLabel =
    instrumentPool === "us_stock" ? "美股衍生池成交额门槛" : "加密货币池成交额门槛";

  const onPoolChange = (pool: InstrumentPool) => {
    setInstrumentPool(pool);
    savePoolPrefs(pool);
  };

  return (
    <div className="app safe-top safe-bottom">
      <div className="top-chrome">
        <div className="brand-strip">
          <span className="re0-logo" aria-label="RE0choice">
            RE0choice
          </span>
        </div>

        <div className="pool-bar" role="tablist" aria-label="标的池">
          <button
            type="button"
            role="tab"
            className={instrumentPool === "crypto" ? "active" : ""}
            aria-selected={instrumentPool === "crypto"}
            onClick={() => onPoolChange("crypto")}
          >
            加密货币
          </button>
          <button
            type="button"
            role="tab"
            className={instrumentPool === "us_stock" ? "active" : ""}
            aria-selected={instrumentPool === "us_stock"}
            onClick={() => onPoolChange("us_stock")}
          >
            美股衍生
          </button>
        </div>

        <div className="status-bar">
          <span className="status-text">
            {poolName} · {dirLabel} · {priceLabel} · {anchorStatusText(anchor)}
          </span>
          <button type="button" className="filter-btn" onClick={() => setFilterOpen(true)}>
            <span className="filter-icon" aria-hidden>
              ⚙
            </span>
            筛选配置
          </button>
        </div>

        <div className="tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            className={direction === "up" ? "active up" : ""}
            aria-selected={direction === "up"}
            onClick={() => setDirection("up")}
          >
            爆增
          </button>
          <button
            type="button"
            role="tab"
            className={direction === "down" ? "active down" : ""}
            aria-selected={direction === "down"}
            onClick={() => setDirection("down")}
          >
            爆减
          </button>
          <button
            type="button"
            role="tab"
            className={priceWindow === "24h" ? "active" : ""}
            aria-selected={priceWindow === "24h"}
            onClick={() => setPriceWindow("24h")}
          >
            24h涨幅
          </button>
          <button
            type="button"
            role="tab"
            className={priceWindow === "today" ? "active" : ""}
            aria-selected={priceWindow === "today"}
            onClick={() => setPriceWindow("today")}
          >
            今日涨幅
          </button>
        </div>

        <div className="table-head">
          <span className="th-left">合约 / 24h均量</span>
          <div className="th-metrics">
            <span>{chgColLabel}</span>
            <span className="th-muted">量比</span>
          </div>
        </div>
      </div>

      {error && <div className="banner err slim">{error}</div>}

      {loading && (
        <div className="banner load slim">
          {progress?.phase === "syncing"
            ? `同步 ${progress.done}/${progress.total}${progress.incrementalHits ? ` · 增量 ${progress.incrementalHits}` : ""}`
            : progress?.phase === "computing"
              ? "并行计算均比…"
              : "拉取合约…"}
          <div className="bar">
            <div
              className="fill"
              style={{
                width: progress?.total
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : "8%",
              }}
            />
          </div>
        </div>
      )}

      {!loading && data && (
        <div className="scan-hint">
          {data.poolLabel} · {data.scanned} 合约 · 命中 {data.matched}
          {data.fromCloud ? " · 云端秒开" : data.fromCache ? " · 本地" : ` · 缓存 ${data.cacheHits}/${data.scanned}`}
        </div>
      )}

      <main className="list">
        {data?.items.map((row, i) => {
          const chg = pickChg(row, priceWindow);
          return (
            <article key={row.instId} className="ticker-row">
              <div className="col-sym">
                <div className="sym-line">
                  <span className="ticker-rank">#{i + 1}</span>
                  <span className="ticker-sym">{row.symbol}</span>
                </div>
                <div className="ticker-vol">
                  {fmtUsd(row.latestVol)} / 均 {fmtUsd(row.avgVol)}
                </div>
              </div>
              <div className="col-metrics">
                <div className="col-chg">
                  <span className="chg-label">{chgColLabel}:</span>
                  <span className={`chg-val ${pctCls(chg)}`}>{fmtPct(chg)}</span>
                </div>
                <div className="col-ratio">
                  <span className="ratio-label">量比:</span>
                  <span className="ratio-val">{fmtPct(row.ratioPct)}</span>
                </div>
              </div>
            </article>
          );
        })}
        {data && !data.items.length && !loading && (
          <p className="empty">暂无符合条件的合约，可点「筛选配置」放宽门槛</p>
        )}
      </main>

      <footer className="footer">
        <div className="footer-actions">
          <CachePanel onCleared={() => runScan(anchor, true)} />
          <button
            type="button"
            className="btn ghost"
            disabled={loading}
            onClick={() => {
              clearInstrumentCache();
              runScan(anchor, true);
            }}
          >
            强制刷新
          </button>
        </div>
      </footer>

      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        thresholdPoolLabel={thresholdPoolLabel}
        minCurrent={activeMinCurrent}
        minMa={activeMinMa}
        onMinCurrent={onMinCurrentChange}
        onMinMa={onMinMaChange}
        anchor={anchor}
        anchorDate={anchorDate}
        anchorHour={anchorHour}
        onAnchorDate={onAnchorDateChange}
        onAnchorHour={onAnchorHourChange}
        onPickLive={pickLive}
        onApplyThresholds={() => runScan(anchor)}
        onApplyHistory={applyHistory}
      />
    </div>
  );
}
