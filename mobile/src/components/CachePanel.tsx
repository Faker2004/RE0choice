import { useCallback, useEffect, useState } from "react";
import {
  clearAllCache,
  fmtBytes,
  formatCacheSummary,
  getCacheReport,
  type CacheReport,
} from "../lib/cacheInfo";

export function CachePanel({ onCleared }: { onCleared?: () => void }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<CacheReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await getCacheReport());
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const onClear = async () => {
    if (!confirm("确定清空本地 K 线缓存？下次扫描需重新下载。")) return;
    setClearing(true);
    try {
      await clearAllCache();
      await refresh();
      onCleared?.();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="cache-panel">
      <button type="button" className="cache-toggle btn ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "收起缓存" : "本地缓存"}
      </button>
      {open && (
        <div className="cache-body">
          {loading && !report && <p className="cache-line">统计中…</p>}
          {report && (
            <>
              <p className="cache-line">{formatCacheSummary(report)}</p>
              {report.usageBytes > 0 && report.quotaBytes > 0 && (
                <div className="cache-bar-wrap">
                  <div
                    className="cache-bar-fill"
                    style={{
                      width: `${Math.min(100, (report.usageBytes / report.quotaBytes) * 100)}%`,
                    }}
                  />
                </div>
              )}
              <p className="cache-sub">
                库名 {report.dbName}（IndexedDB）
                {report.usageBytes > 0 && ` · App 存储 ${fmtBytes(report.usageBytes)}`}
              </p>
            </>
          )}
          <div className="cache-actions">
            <button type="button" className="btn ghost sm" onClick={refresh} disabled={loading}>
              刷新
            </button>
            <button type="button" className="btn ghost sm danger" onClick={onClear} disabled={clearing}>
              {clearing ? "清空中…" : "清空缓存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
