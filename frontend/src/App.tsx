import { useCallback, useEffect, useRef, useState } from "react";
import {
  bjDateStr,
  fetchRadar,
  fmtPct,
  fmtUsd,
  pickPriceChg,
} from "./api";
import type { AnchorQuery, PriceWindow, RadarResponse, SurgeDirection } from "./types";
import { initialAnchorState, saveAnchorPrefs } from "./anchorPrefs";

const DEFAULT_MIN_CURRENT = 1_000_000;
const DEFAULT_MIN_MA = 500_000;

const DIRECTIONS: { key: SurgeDirection; label: string }[] = [
  { key: "up", label: "爆增榜" },
  { key: "down", label: "爆减榜" },
];

const PRICE_WINDOWS: { key: PriceWindow; label: string }[] = [
  { key: "24h", label: "24h涨幅" },
  { key: "today", label: "今日涨幅" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const _initAnchor = initialAnchorState();

function anchorMatches(anchor: AnchorQuery, data: RadarResponse): boolean {
  if (anchor.mode === "live") return data.live;
  return !data.live && data.anchorTime.startsWith(`${anchor.date} ${String(anchor.hour).padStart(2, "0")}`);
}

export default function App() {
  const [direction, setDirection] = useState<SurgeDirection>("up");
  const [priceWindow, setPriceWindow] = useState<PriceWindow>("24h");
  const [minCurrentVol, setMinCurrentVol] = useState(DEFAULT_MIN_CURRENT);
  const [minMaVol, setMinMaVol] = useState(DEFAULT_MIN_MA);
  const [draftMinCurrent, setDraftMinCurrent] = useState(String(DEFAULT_MIN_CURRENT));
  const [draftMinMa, setDraftMinMa] = useState(String(DEFAULT_MIN_MA));

  const [anchor, setAnchor] = useState<AnchorQuery>(_initAnchor.anchor);
  const [anchorDate, setAnchorDate] = useState(
    () => _initAnchor.anchorDate || bjDateStr(-1),
  );
  const [anchorHour, setAnchorHour] = useState(_initAnchor.anchorHour);

  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadSeq = useRef(0);

  const thresholdsDirty =
    Number(draftMinCurrent) !== minCurrentVol || Number(draftMinMa) !== minMaVol;

  const applyThresholds = () => {
    setMinCurrentVol(Math.max(0, Number(draftMinCurrent) || 0));
    setMinMaVol(Math.max(0, Number(draftMinMa) || 0));
  };

  const load = useCallback(
    async (refresh = false) => {
      const seq = ++loadSeq.current;
      const anchorSnap = anchor;
      const curVol = Math.max(0, Number(draftMinCurrent) || 0);
      const maVol = Math.max(0, Number(draftMinMa) || 0);
      setMinCurrentVol(curVol);
      setMinMaVol(maVol);
      setLoading(true);
      setError("");
      try {
        const res = await fetchRadar(direction, anchorSnap, {
          minCurrentVol: curVol,
          minMaVol: maVol,
          limit: 50,
          refresh,
        });
        if (seq !== loadSeq.current) return;
        setData(res);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [anchor, direction, draftMinCurrent, draftMinMa],
  );

  useEffect(() => {
    load();
  }, [load]);

  const applyHistoryAnchor = () => {
    setError("");
    const next: AnchorQuery = { mode: "history", date: anchorDate, hour: anchorHour };
    setAnchor(next);
    saveAnchorPrefs({ mode: "history", date: anchorDate, hour: anchorHour });
  };

  const pickLive = () => {
    setAnchor({ mode: "live" });
    saveAnchorPrefs({ mode: "live", date: anchorDate, hour: anchorHour });
  };

  const onAnchorDateChange = (date: string) => {
    setAnchorDate(date);
    saveAnchorPrefs({ mode: anchor.mode, date, hour: anchorHour });
  };

  const onAnchorHourChange = (hour: number) => {
    setAnchorHour(hour);
    saveAnchorPrefs({ mode: anchor.mode, date: anchorDate, hour });
  };

  const boardTitle = direction === "up" ? "成交额暴增雷达" : "成交额爆减雷达";
  const priceLabel = PRICE_WINDOWS.find((p) => p.key === priceWindow)!.label;
  const cacheHint = data?.fromCache
    ? "本地 SQLite 全部命中，零网络补抓"
    : data
      ? data.fetchedBars === 0
        ? `SQLite 合约缓存 ${data.cacheHits}/${data.scanned}`
        : `增量补抓 ${data.fetchedBars} 条 · 合约缓存 ${data.cacheHits}/${data.scanned}`
      : null;

  return (
    <div className="app">
      <div className="glow glow-a" aria-hidden />
      <div className="glow glow-b" aria-hidden />

      <header className="header">
        <div className="brand">
          <div className="brand-badge">RE0choice</div>
          <h1>{boardTitle}</h1>
          <p className="subtitle">
            OKX USDT 永续 · 1h K 线 · volCcyQuote 成交额 · 北京时间对齐
            {cacheHint && <span className="cache-pill">{cacheHint}</span>}
          </p>
        </div>

        <div className="toolbar">
          <div className="ctrl-block">
            <span className="ctrl-label">榜单</span>
            <div className="seg seg-direction">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`seg-btn ${direction === d.key ? `active ${d.key}` : ""}`}
                  onClick={() => setDirection(d.key)}
                  disabled={loading}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctrl-block">
            <span className="ctrl-label">价格</span>
            <div className="seg">
              {PRICE_WINDOWS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`seg-btn ${priceWindow === p.key ? "active gold" : ""}`}
                  onClick={() => setPriceWindow(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctrl-block thresholds">
            <span className="ctrl-label">流动性门槛</span>
            <div className="threshold-row">
              <label>
                <span>当前≥</span>
                <input
                  type="number"
                  min={0}
                  step={100000}
                  value={draftMinCurrent}
                  onChange={(e) => setDraftMinCurrent(e.target.value)}
                  disabled={loading}
                />
                <span className="unit">USDT</span>
              </label>
              <label>
                <span>均量≥</span>
                <input
                  type="number"
                  min={0}
                  step={100000}
                  value={draftMinMa}
                  onChange={(e) => setDraftMinMa(e.target.value)}
                  disabled={loading}
                />
                <span className="unit">USDT</span>
              </label>
              <button
                type="button"
                className={`btn-apply ${thresholdsDirty ? "pulse" : ""}`}
                onClick={applyThresholds}
                disabled={loading || !thresholdsDirty}
              >
                应用
              </button>
            </div>
          </div>

          <button type="button" className="btn-refresh" onClick={() => load(true)} disabled={loading}>
            {loading ? "扫描中…" : "强制刷新"}
          </button>
        </div>

        <div className="anchor-row">
          <span className="ctrl-label">时间锚定</span>
          <button
            type="button"
            className={`btn-apply ${anchor.mode === "live" ? "active" : ""}`}
            onClick={pickLive}
            disabled={loading}
          >
            实时（最新 K 线）
          </button>
          <span className="sep">或</span>
          <input
            type="date"
            className="date-input"
            value={anchorDate}
            max={bjDateStr(0)}
            onChange={(e) => onAnchorDateChange(e.target.value)}
            disabled={loading}
          />
          <select
            className="hour-select"
            value={anchorHour}
            onChange={(e) => onAnchorHourChange(Number(e.target.value))}
            disabled={loading}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn-apply ${anchor.mode === "history" ? "active" : ""}`}
            onClick={applyHistoryAnchor}
            disabled={loading}
          >
            应用
          </button>
          {anchor.mode === "history" && (
            <span className="anchor-hint">
              锚定 {anchor.date} {String(anchor.hour).padStart(2, "0")}:00（北京时间）
              · 分子 K 线{" "}
              {anchor.hour <= 0
                ? "前日 23:00"
                : `${String(anchor.hour - 1).padStart(2, "0")}:00`}
              ~{String(anchor.hour).padStart(2, "0")}:00
            </span>
          )}
          {anchor.mode === "live" && (
            <span className="anchor-hint">
              Ratio = 当前小时成交额 / MA(T-1..T-24) - 1
            </span>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {loading && (
        <div className="banner loading">
          正在扫描全市场永续合约…
          {anchor.mode === "history"
            ? ` 历史锚定 ${anchor.date} ${String(anchor.hour).padStart(2, "0")}:00`
            : " 实时模式"}
          <br />
          首次约 30～90 秒，后续本地 SQLite 秒开
        </div>
      )}

      {data && !loading && anchorMatches(anchor, data) && (
        <section className="panel">
          <div className="panel-meta">
            <span>{data.anchorLabel}</span>
            <span>
              {data.scanned} 合约 · 命中 {data.matched} · Top {data.items.length}
              {data.cacheHits > 0 && ` · 合约缓存 ${data.cacheHits}/${data.scanned}`}
              {(data.cacheBarHits ?? 0) > 0 && ` · K线命中 ${data.cacheBarHits}`}
              {data.direction === "down" && " · 爆减榜仅显示 Ratio<0"}
              {data.direction === "up" && " · 爆增榜仅显示 Ratio>0"}
            </span>
          </div>

          <div className="table-wrap">
            <table className="radar-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>合约</th>
                  <th>当前成交额 / 24h均量</th>
                  <th>均比 (Ratio)</th>
                  <th>{priceLabel}</th>
                  <th>K线时间 (北京 T)</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row, i) => {
                  const priceChg = pickPriceChg(row, priceWindow);
                  return (
                    <tr key={row.instId}>
                      <td className="rank">{i + 1}</td>
                      <td className="sym">{row.symbol}</td>
                      <td className="vol">
                        <span className="vol-main">{fmtUsd(row.latestVol)}</span>
                        <span className="vol-sub">均 {fmtUsd(row.avgVol)}</span>
                      </td>
                      <td className={ratioClass(row.ratioPct)}>{fmtPct(row.ratioPct)}</td>
                      <td className={ratioClass(priceChg)}>{fmtPct(priceChg)}</td>
                      <td className="time">{row.klineTime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!data.items.length && (
            <p className="empty">暂无符合条件的合约，可放宽流动性门槛后重试</p>
          )}
        </section>
      )}

      <footer className="footer">
        <span>数据：OKX 公开 API · 本地库 market_data.db</span>
        <span>更新 {data?.updatedAt ?? "—"}</span>
      </footer>
    </div>
  );
}

function ratioClass(v: number | null | undefined): string {
  if (typeof v !== "number") return "";
  return v >= 0 ? "up" : "down";
}
