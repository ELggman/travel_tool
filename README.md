# 沿路 / YANLU

和朋友一起规划旅行的本地优先 App。一次旅行按天排好行程，每天的地点、时间、交通与预订串在同一条路线上；拖动调整顺序，地图与时间一起重排。

> 当前是**视觉与交互原型**，地图、数据和同步都还是演示实现。真实地图、局域网协作与 APK 的实现规划见 [docs/PLAN.md](docs/PLAN.md)。

## 当前状态

- 390 × 844 的三状态原型：旅行总览、某一天的行程与地图、拖动调整顺序。
- 单文件、无外部依赖，可直接打开。
- 手绘 SVG 地图与演示数据；拖拽、路线预览、里程/时间重排、撤销是真实可交互的。
- 尚未接入真实经纬度、地图瓦片、算路、持久化、局域网同步与 Android 壳。

## 预览

直接打开：

```bash
open index.html          # 可交互原型
open screens.html        # 三屏并排展示
```

或起一个本地静态服务：

```bash
python3 -m http.server 8080
# http://localhost:8080/index.html
# http://localhost:8080/screens.html
```

`index.html` 底部有 `01 / 02 / 03` 状态切换，右上角可跳到三屏页。打开任意一天后，按住行程卡拖动即可看到路线与时间的实时重排。

## 接下来

两个核心技术点：

1. **地图与每日路线**：MapLibre + OpenFreeMap（在线）/ PMTiles（离线）；真实坐标、路线几何、算路与缓存。
2. **局域网协作**：Capacitor + 原生 Kotlin 插件；一台手机作为 Host Session，通过 NSD/二维码发现加入，房主串行广播修改；不依赖公网服务器。

目标栈：Vite + TypeScript + React / MapLibre / dnd-kit / SQLite / Capacitor Android。详细路线图、数据模型、风险与验收标准见 [docs/PLAN.md](docs/PLAN.md)。

## Git

- `main` 为主分支；功能分支使用 `feat/*`。
- 原型基线标签：`v0.1-prototype`。
- APK、签名、地图大包不提交；见 `.gitignore`。

## 说明

`screens.html` 只用于设计展示，不进入 APK。正式 App 会在 `app/` 中重构，原型保留作视觉参考。
