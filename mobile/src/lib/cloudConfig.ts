/**
 * 云端 data.json 地址 — 部署前请改成你的 GitHub 仓库。
 *
 * 方式 A — GitHub Raw（公开仓库）:
 *   https://raw.githubusercontent.com/<USER>/<REPO>/main/cloud-data/data.json
 *
 * 方式 B — jsDelivr CDN（公开仓库，全球加速）:
 *   https://cdn.jsdelivr.net/gh/<USER>/<REPO>@main/cloud-data/data.json
 *
 * 私有仓库 Raw 需 Token，手机端无法安全嵌入，建议 cloud-data 目录用公开仓库或独立公开仓。
 */
export const CLOUD_DATA_URL =
  import.meta.env.VITE_CLOUD_DATA_URL?.trim() ||
  "https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@main/cloud-data/data.json";

/** 快照超过此分钟数视为过期，回退 OKX 直连 */
export const CLOUD_MAX_AGE_MINUTES = 120;
