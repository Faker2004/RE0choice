# 云端 K 线快照（GitHub Actions 免费 Cron）

## 架构

```
GitHub Actions (每小时)
    → update_okx.py
    → cloud-data/data.json (每合约 25 根 1h K 线)
    → jsDelivr / Raw CDN
    → 手机 App 0.1s 拉取 → 秒开榜单
```

## 首次部署

1. 将 `RE0choice` 推送到 GitHub（`cloud-data/` 与 `.github/workflows/cron.yml` 一并提交）
2. 仓库 **Settings → Actions → General → Workflow permissions** 设为 **Read and write**
3. Actions 页手动运行 **OKX Cloud Kline Sync**（`workflow_dispatch`）做首次 bootstrap
4. 等待 `data.json` 提交完成后，修改手机端 `mobile/.env`：

```env
VITE_CLOUD_DATA_URL=https://cdn.jsdelivr.net/gh/<你的用户名>/<你的仓库名>@main/cloud-data/data.json
```

5. `npm run build` + `npx cap sync android`

## 私有仓库说明

- jsDelivr / GitHub Raw **仅支持公开仓库**免 Token 访问
- 若主仓私有：可另建 **公开仓** 只放 `cloud-data/data.json`，或把该目录同步到 Gist

## 本地测试

```bash
cd cloud-data
pip install -r requirements.txt
python update_okx.py
```

## Cron 时区

工作流使用 UTC `5 * * * *`（每小时第 5 分），给 OKX 1h K 线收盘留缓冲。
