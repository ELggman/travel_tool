# 沿路 App · M1

M1 的目标不是继续做地图验证，而是把“省份 / 城市地图包 + 单日行程编辑”做成可运行的产品闭环。

## 已实现

- **省份 / 城市地图包**
  - 重庆、湖北、贵州、黑龙江四个省份入口
  - 重庆 / 武汉 / 贵阳三个可下载城市；哈尔滨为“准备中”占位
  - 城市卡显示体积、版本、下载状态；下载/删除/占用空间
  - 下载会读取城市 `manifest.json` 和两张路网图，显示进度
- **按城市切换 UI 主题**
  - 每个城市有独立色板、标题、印章、地图配色
  - 打开地图包时选中其他省份会即时预览主题；选择已下载城市后整个 App 切换
- **重庆单日行程编辑**
  - 4 个种子地点；添加地点、删除地点、修改停留时长
  - 每个 leg 切换步行/打车
  - 用 dnd-kit 拖动排序；放开后重算所有 leg、路线、到达/离开时间
  - 出发时间可改
  - 预订/备注字段
- **本地算路与地图**
  - MapLibre + 本地 ZXY 瓦片 + 本地步行/打车图 + Web Worker A*
  - 路线按步行/打车分色；地图上显示序号 marker
  - 所有路线与时间重算在浏览器内完成
- **持久化**
  - 行程、顺序、停留时间、交通方式、预订、当前城市、已下载城市写入 localStorage
  - 关闭/刷新/重开仍保留

## 运行

```bash
cd app
npm install
npm run dev
# http://127.0.0.1:5173
```

生产构建：

```bash
npm run build
npm run preview
```

### 准备地图包

`public/packs` 是生成目录，不提交 Git。当前从已有的 Android 静态瓦片和 `spikes/data` 路网图生成：

```bash
cd app
./scripts/prepare-packs.sh
```

脚本会为每个城市生成：

```text
public/packs/<city>/
├── manifest.json
├── walk.json
├── car.json
└── tiles/<z>/<x>/<y>.mvt   # gzip MVT
```

真实的省/城市包流水线仍是 `PMTiles extract + OSM graph`，见 [三城报告](../docs/spikes/city-map-report.md)。M1 用静态 ZXY 树是为了先在 WebView 里跑通完整产品闭环。

## 结构

```text
src/
├── App.tsx                 # 页面状态、行程编辑、持久化、包下载
├── components/
│   ├── MapView.tsx         # MapLibre + route GeoJSON + stop markers
│   └── Sheets.tsx          # 地图包 / 加地点 / 编辑地点
├── data/
│   ├── packs.ts            # 省份、城市、主题、种子行程、包元数据
│   ├── places.generated.ts # 从 spikes/places-routes.json 生成
│   └── types.ts
├── hooks/useRouting.ts     # worker 请求、leg 状态、fallback
├── routing/worker.ts       # 本地 A* Web Worker
└── utils.ts
```

## M1 边界

- 只做**单日**行程；多日、行程列表、真实航班/酒店表单在 M2。
- 添加地点使用每城 8–11 个精选地点，没有离线 POI 搜索/地图选点。
- 下载当前只实际拉取 `manifest + walk/car` 路网；底图瓦片随 App 打包，真正的远程 pack archive/解压/校验在 M2。
- 存储用 localStorage；M2 换 IndexedDB，并做数据迁移。
- 没有账号、云同步、局域网协作。
- 地图还没有道路/POI 文字标签，只有行程点 marker。

## 验证

已在 Chrome 和 Android 35 arm64 模拟器上验证：三城切换、包下载/使用、主题变化、加地点、改停留、拖动排序、路线/时间更新、刷新/重启持久化、飞行模式离线加载。

真机 APK 在 `android/build/yanlu-spike-debug.apk`，构建方式见 [android/README.md](../android/README.md)。
