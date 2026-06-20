# RE0choice 手机独立版 · OKX 成交额雷达

完全独立的单兵 App：**不连接 PC 端 Python 后端**，所有 OKX 请求、北京时间对齐、MA24 均比计算、IndexedDB 增量缓存均在手机端完成。

技术栈：**React + TypeScript + Vite + IndexedDB + Capacitor**

## 目录结构

```
mobile/
├── src/
│   ├── App.tsx           # 黑金 UI（ListView 滚动列表）
│   ├── lib/
│   │   ├── okx.ts        # OKX V5 API 直连
│   │   ├── klineDb.ts    # IndexedDB 增量缓存
│   │   ├── radar.ts      # Ratio 计算 + 双榜排序
│   │   ├── timezone.ts   # UTC → 北京时间对齐
│   │   └── format.ts
│   └── types.ts
├── capacitor.config.ts
└── package.json
```

## 一、电脑上预览（浏览器模拟手机）

```bash
cd RE0choice/mobile
npm install
npm run dev
```

手机与电脑同一 WiFi 时，用手机浏览器访问 `http://<电脑IP>:5195` 即可体验（需联网访问 OKX）。

## 二、打包 Android APK（推荐 Capacitor）

### 环境准备

1. 安装 [Node.js 18+](https://nodejs.org/)
2. 安装 [Android Studio](https://developer.android.com/studio)（含 Android SDK）
3. 设置环境变量 `ANDROID_HOME`（Android Studio → SDK Manager 可查看路径）

### 打包步骤

```bash
cd RE0choice/mobile

# 1. 安装依赖
npm install

# 2. 构建 Web 资源
npm run build

# 3. 初始化 Capacitor Android 工程（仅首次）
npx cap add android

# 4. 同步 Web 资源到原生工程
npx cap sync android

# 5. 用 Android Studio 打开并编译 APK
npx cap open android
```

在 Android Studio 中：

1. 等待 Gradle 同步完成
2. 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. APK 输出路径：`android/app/build/outputs/apk/debug/app-debug.apk`

### 安装到手机

**方式 A（USB 调试，最简单）**

1. 手机开启「开发者选项 → USB 调试」
2. USB 连接电脑
3. Android Studio 点击绿色 ▶ Run，直接装到手机

**方式 B（APK 文件）**

把 `app-debug.apk` 传到手机安装。若提示未知来源，在系统设置中允许安装。

## 三、打包 iOS（需 macOS + Xcode）

```bash
cd RE0choice/mobile
npm install && npm run build
npx cap add ios      # 仅首次
npx cap sync ios
npx cap open ios
```

在 Xcode 中选择真机或模拟器，点击 Run。上架 App Store 需 Apple 开发者账号。

## 四、核心逻辑说明（与 PC 端一致）

| 项目 | 说明 |
|------|------|
| 分子 Current_Vol | 北京时间 T 小时那根 1h K 线成交额（T=11:00 → 10:00~11:00） |
| 分母 MA_24_Vol | T-1 至 T-24 共 24 根 1h 成交额均值 |
| Ratio | `(Current / MA24) - 1`，百分比展示 |
| 爆增榜 | Ratio > 0，降序 |
| 爆减榜 | Ratio < 0，升序（越负越靠前） |
| 时区 | OKX UTC 时间戳 → 转北京时间 `timestamp_bj` 存储 |
| 缓存 | IndexedDB，`INSERT` 去重，本地已覆盖则零网络请求 |

## 五、默认门槛

- `min_current_vol` = 1,000,000 USDT
- `min_ma_vol` = 500,000 USDT

## 六、注意事项

- 首次全市场扫描约 1～3 分钟（372+ 合约），之后同时间段本地秒开
- 需手机能访问 `https://www.okx.com`（与 PC 端一样走 OKX 公开 API）
- 数据存于手机 IndexedDB，卸载 App 会清空缓存
- 本 App 与 PC 端 **零数据交互**，各自独立运行

## 免责声明

仅供学习研究，不构成投资建议。请遵守 OKX API 使用条款。
