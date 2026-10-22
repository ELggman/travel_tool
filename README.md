# 沿路 / YANLU

和朋友一起规划旅行的本地优先 App。一次旅行按天排好行程，每天的地点、时间、交通与预订串在同一条路线上；拖动调整顺序，地图与时间一起重排。

> 当前是**视觉与交互原型**，地图、数据和同步都还是演示实现。真实地图、局域网协作与 APK 的实现规划见 [docs/PLAN.md](docs/PLAN.md)；首批城市验证计划见 [docs/SPIKE-CITIES.md](docs/SPIKE-CITIES.md)。

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

第一版已确定的方向：

- **朋友内部使用，暂不上架**；因此走开源地图栈 A：MapLibre + PMTiles + 本地路由。
- **中国国内地图**，首批城市 **重庆 / 武汉 / 贵阳**；在线优先 + 完全离线兜底，用户可按城市下载离线包。
- **离线重算**步行 / 打车路线，不只缓存瓦片；路线、每日里程、交通时间都来自真实路网。
- **离线包静态分发**：允许对象存储/CDN，只放地图数据；国内优先 OSS/COS。
- **局域网协作**：Capacitor + 原生插件；一台手机作为 Host Session，通过 NSD/二维码发现加入，房主串行广播修改；不依赖公网服务器。房主保持 App 打开这一限制已接受。
- **Android 优先，后续 iOS**；UI、协议、离线包格式要为 iOS 复用留出空间。
- 第一版不做公交/地铁、账号、云端、照片同步。

目标栈：Vite + TypeScript + React / MapLibre / dnd-kit / SQLite / Capacitor；离线路由优先评估「城市路网 + TS A*」，备选 GraphHopper（Android）/ Valhalla（跨端）。

三城第一轮验证已完成（2026-10-22）：30/30 路线可计算，28/30 与 OSRM 距离误差 ≤10%，断外网可加载与重算；条件通过，继续开源栈 A。结果、截图与限制见 [三城报告](docs/spikes/city-map-report.md)，验收方法见 [docs/SPIKE-CITIES.md](docs/SPIKE-CITIES.md)。

### 还未确认

1. 群组规模与使用频率。
2. 是否需要同步照片/票据；v1 建议只同步结构化行程。
3. 三城核心区 bbox（重庆尤其需要限定范围）。
4. 静态包托管商（阿里云 OSS / 腾讯云 COS / 其他）与域名。

## Git

- `main` 为主分支；功能分支使用 `feat/*`。
- 原型基线标签：`v0.1-prototype`。
- APK、签名、地图大包不提交；见 `.gitignore`。

## 说明

`screens.html` 只用于设计展示，不进入 APK。正式 App 会在 `app/` 中重构，原型保留作视觉参考。
