import type { AnchorMode } from "../types";
import { bjDateStr } from "../lib/timezone";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Props = {
  open: boolean;
  onClose: () => void;
  thresholdPoolLabel: string;
  minCurrent: string;
  minMa: string;
  onMinCurrent: (v: string) => void;
  onMinMa: (v: string) => void;
  anchor: AnchorMode;
  anchorDate: string;
  anchorHour: number;
  onAnchorDate: (d: string) => void;
  onAnchorHour: (h: number) => void;
  onPickLive: () => void;
  onApplyThresholds: () => void;
  onApplyHistory: () => void;
};

export function FilterDrawer({
  open,
  onClose,
  thresholdPoolLabel,
  minCurrent,
  minMa,
  onMinCurrent,
  onMinMa,
  anchor,
  anchorDate,
  anchorHour,
  onAnchorDate,
  onAnchorHour,
  onPickLive,
  onApplyThresholds,
  onApplyHistory,
}: Props) {
  if (!open) return null;

  const applyHistory = () => {
    onApplyHistory();
    onClose();
  };

  const applyThresholds = () => {
    onApplyThresholds();
    onClose();
  };

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="筛选配置">
      <button type="button" className="drawer-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="drawer-sheet">
        <div className="drawer-handle" />
        <div className="drawer-title">筛选配置</div>

        <div className="drawer-section">
          <div className="drawer-label">{thresholdPoolLabel}</div>
          <div className="drawer-row">
            <label>
              当前≥
              <input
                type="number"
                inputMode="numeric"
                value={minCurrent}
                onChange={(e) => onMinCurrent(e.target.value)}
              />
            </label>
            <label>
              均量≥
              <input
                type="number"
                inputMode="numeric"
                value={minMa}
                onChange={(e) => onMinMa(e.target.value)}
              />
            </label>
          </div>
          <button type="button" className="btn drawer-btn" onClick={applyThresholds}>
            应用门槛
          </button>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">时间锚定（北京）</div>
          <div className="drawer-row anchor">
            <button
              type="button"
              className={`btn ${anchor.mode === "live" ? "active" : ""}`}
              onClick={onPickLive}
            >
              实时
            </button>
            <input
              type="date"
              value={anchorDate}
              max={bjDateStr(0)}
              onChange={(e) => onAnchorDate(e.target.value)}
            />
            <select value={anchorHour} onChange={(e) => onAnchorHour(Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
          {anchor.mode === "history" && (
            <p className="hint">
              锚定 {anchor.date} {String(anchor.hour).padStart(2, "0")}:00
              · 分子{" "}
              {anchor.hour <= 0
                ? "前日23:00"
                : `${String(anchor.hour - 1).padStart(2, "0")}:00`}
              ~{String(anchor.hour).padStart(2, "0")}:00
            </p>
          )}
          <button type="button" className="btn gold drawer-btn" onClick={applyHistory}>
            应用时间
          </button>
        </div>

        <button type="button" className="btn ghost drawer-close" onClick={onClose}>
          收起
        </button>
      </div>
    </div>
  );
}
