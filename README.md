# 沿路 / YANLU

和朋友一起规划旅行的本地优先 App。一次旅行按天排好行程，每天的地点、时间、交通与预订串在同一条路线上；拖动调整顺序，地图与时间一起重排。

> M2.1/M2.2a 已在 `app/` 落地：真实城市包归档下载、本机 CacheStorage、删除释放、首启下载、按城市换主题、中文道路/POI 标注、单日行程编辑与本地 A*。`index.html` / `screens.html` 保留为视觉原型。

## M1 当前可用

- `app/`：React + Vite + MapLibre + 本地 A* Web Worker。
- 省份/城市地图包：重庆、湖北、贵州、黑龙江；真实 `.yanlu-pack.zip` 归档下载到 CacheStorage，删除会释放缓存；当前可下载重庆/武汉/贵阳，哈尔滨为占位。
- 首启无缓存时进入“先下载一座城市”；下载完成才进入行程。
- 按城市切换 UI 主题、地图配色、标题与印章。
- 单日行程：加地点、删地点、改停留、步行/打车、拖动排序；路线与时间自动重算；localStorage 持久化。
- 中文道路/地点/POI 标注：本地 glyphs + 系统 CJK 字体，离线可用。
- 可选精细底图：重庆核心区 z16 独立下载；标准包已扩到重庆主城全区。
- 地图启动按低缩放 + 行程 bbox 优先加载，高缩放瓦片后台补齐；WebView 启动底色和纸张色加载层减少白屏/黑屏。
- 离线 POI 搜索：重庆 2.0 万条 OSM 地点，索引随城市包下载，搜索后直接加进行程。
- 多日行程：DAY 01 / DAY 02 切换，出发日期可选，每天独立标题、地点、固定时间、备注与住宿。
- Android 壳：`android/build/yanlu-spike-debug.apk`，基座约 637 KB；POI 索引随城市包；地图包从 pack server 下载。真机需填 Mac 局域网 IP，不需要科学上网。
- 详细：[App 说明](app/README.md)、[M2.1 验证记录](docs/m2/README.md)、[M2.2a 中文标注](docs/m2/labels/README.md)。

```bash
cd app && npm install && npm run dev     # http://127.0.0.1:5173
cd app && python3 scripts/pack_server.py --port 8090  # 另开一个终端
cd app && npm run build                  # 产物在 app/dist
```

### 原型

- 390 × 844 的三状态原型：旅行总览、某一天的行程与地图、拖动调整顺序。
- 单文件、无外部依赖，可直接打开。
- 手绘 SVG 地图与演示数据；拖拽、路线预览、里程/时间重排、撤销是真实可交互的。

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

三城第一轮验证已完成（2026-10-22）：30/30 路线可计算，28/30 与 OSRM 距离误差 ≤10%，断外网可加载与重算；M1 已在 Android 35 模拟器跑通。结果、截图与限制见 [三城报告](docs/spikes/city-map-report.md) 与 [M1 记录](docs/m1/README.md)。

### 还未确认

1. 群组规模与使用频率。
2. 是否需要同步照片/票据；v1 建议只同步结构化行程。
3. 静态包托管商（阿里云 OSS / 腾讯云 COS / 其他）与域名。
4. 黑龙江等省份的真实城市包接入顺序。

## Git

- `main` 为主分支；功能分支使用 `feat/*`。
- 原型基线标签：`v0.1-prototype`。
- APK、签名、地图大包不提交；见 `.gitignore`。

## 说明

`screens.html` 只用于设计展示，不进入 APK。正式 App 在 `app/`；原型保留作视觉参考。
