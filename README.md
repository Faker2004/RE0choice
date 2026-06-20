# OKX 合约成交额暴增/爆减雷达 · RE0choice

基于 OKX 全市场 USDT 永续合约 **1 小时 K 线**，计算成交额相对 24 小时均量的偏离率（Ratio），支持爆增榜 / 爆减榜双榜排序。后端 FastAPI + SQLite 增量缓存，前端 React + Vite 黑金主题。

## 快速启动

**Windows（推荐）**

```bat
start.bat
```

**或手动**

```bash
cd RE0choice
python start.py
```

首次运行会自动：`pip install` 后端依赖 → `npm install && npm build` 前端 → 启动 `http://127.0.0.1:8030`。

## 环境要求

| 组件 | 版本 |
|------|------|
| Python | 3.10+ |
| Node.js | 18+（仅首次构建前端需要） |

## 手动安装依赖

```bash
# 后端
cd backend
pip install -r requirements.txt

# 前端（开发模式）
cd ../frontend
npm install
npm run dev    # http://localhost:5190，API 代理到 8030
```

生产构建：

```bash
cd frontend && npm run build
cd ../backend && uvicorn main:app --host 127.0.0.1 --port 8030
```

## 核心逻辑

- **分子 Current_Vol**：北京时间锚定小时 T 对应的那根 1h K 线成交额（如 T=11:00 → 10:00~11:00）
- **分母 MA_24_Vol**：从 T-1 往前共 24 根 1h K 线成交额均值
- **Ratio** = `(Current_Vol / MA_24_Vol) - 1`，以百分比展示
- **爆增榜**：Ratio > 0，降序
- **爆减榜**：Ratio < 0，升序（越负越靠前）

## 本地数据库

项目根目录自动创建 `market_data.db`（SQLite），表字段：

`symbol, timestamp_bj, open, high, low, close, volume, turnover`

- `timestamp_bj`：北京时间整点 K 线 open 时间（`YYYY-MM-DD HH:00:00`）
- 增量更新：`INSERT OR IGNORE`，本地已完整覆盖则零网络请求

## API

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/radar` | 雷达榜单 |
| `GET /api/cache/info` | 缓存统计 |
| `POST /api/cache/clear` | 清空 SQLite + 内存缓存 |

### `/api/radar` 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `direction` | `up` | `up` 爆增 / `down` 爆减 |
| `min_current_vol` | 1000000 | 当前成交额门槛 (USDT) |
| `min_ma_vol` | 500000 | 24h 均量门槛 (USDT) |
| `date` | 空 | 锚定日期 `YYYY-MM-DD`（北京时间），空=实时 |
| `hour` | - | 锚定小时 0-23（需配合 date） |
| `limit` | 50 | 返回条数 |
| `refresh` | false | 强制重算 |

## 项目结构

```
RE0choice/
├── market_data.db      # 运行时自动创建
├── start.bat / start.py
├── backend/
│   ├── main.py           # FastAPI
│   ├── database.py       # SQLite 仓库
│   ├── okx_client.py     # OKX API + 时区转换
│   └── radar_engine.py   # 均比计算与排序
└── frontend/
    └── src/              # React + TS + Vite
```

## 时区说明

OKX API 返回 UTC 时间戳；后端统一转换为 **北京时间 (UTC+8)** 后存入 `timestamp_bj`，前端锚定时间与 K 线实际发生时间一致，避免 4/8 小时偏差。

## 免责声明

仅供学习与研究，不构成投资建议。请遵守 OKX API 使用条款与频率限制。
