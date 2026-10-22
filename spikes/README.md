# 三城离线地图与本地路由 · 技术 Spike

这是 [docs/PLAN.md](../docs/PLAN.md) 中 Phase 2–4 的前置验证，不是正式 App。

- 结果报告：[docs/spikes/city-map-report.md](../docs/spikes/city-map-report.md)
- 三城：重庆、武汉、贵阳
- 路线：30 条样本；28/30 与 OSRM 基线距离误差 ≤10%，29/30 ≤20%
- 离线：外部 DNS 被阻断时，仍能加载本地 PMTiles、加载路网图、在浏览器内重算 A*
- 单城包：PMTiles 3.65–7.25 MB；两张路网图 6.47–13.96 MB

## 目录

```text
spikes/
├── cities.json                 # 城市 bbox / PBF / 包名
├── places-routes.json          # 样本地点与 30 条路线
├── scripts/
│   ├── extract_city.py         # pyosmium：PBF → 路网/POI JSON
│   ├── build_graph.py          # 步行/打车图 + 最大连通分量 + snap
│   ├── combine_web_data.py     # 合并路线/OSRM 给预览页
│   ├── make_manifest.py        # 城市包 manifest + SHA-256
│   ├── range_server.py         # 带 Range/CORS 的静态包服务
│   └── compare_osrm.py         # 开发期 OSRM 对照（不进入 App）
├── routing/astar.ts            # Node 版本地 A*
├── web/
│   ├── preview.html            # MapLibre + 本地 PMTiles + 浏览器 A*
│   ├── vendor/                 # 本地 MapLibre GL JS 5.24
│   └── data/                   # 路线摘要 / GeoJSON / manifest（已提交）
└── out/                        # 路线摘要、GeoJSON、OSRM 对照、CSV（已提交）
```

以下**不进入 Git**：

- `spikes/data/`：省级 PBF、提取后的 OSM JSON、路网图（约 31 MB）
- `spikes/map/`：PMTiles 城市包（约 17 MB）
- `spikes/web/data/graphs/`：预览页用的路网图副本
- `tools/`：pmtiles CLI 二进制
- `.venv-spike/`

## 复现

依赖：

- Python 3.13（`osmium`、`mapbox-vector-tile`）
- Node 24（原生运行 TypeScript）
- [go-pmtiles](https://github.com/protomaps/go-pmtiles) v1.31.2
- 地图包来自 Protomaps 的 [public daily build](https://maps.protomaps.com/builds)（本报告使用 `20261021.pmtiles`，仅做远程 extract，不下载全球 139 GB 文件）

```bash
python3 -m venv .venv-spike
.venv-spike/bin/pip install osmium mapbox-vector-tile

curl -L -o /tmp/pmtiles.zip \
  https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles-1.31.2_Darwin_arm64.zip
unzip -o /tmp/pmtiles.zip -d tools && chmod +x tools/pmtiles

mkdir -p spikes/data/osm spikes/map
for r in chongqing hubei guizhou; do
  curl -L -A "yanlu-spike/0.1" -o "spikes/data/osm/$r-latest.osm.pbf" \
    "https://download.geofabrik.de/asia/china/$r-latest.osm.pbf"
done

for c in chongqing wuhan guiyang; do
  .venv-spike/bin/python spikes/scripts/extract_city.py "$c"
  .venv-spike/bin/python spikes/scripts/build_graph.py "$c"
  node spikes/routing/astar.ts "$c"
done

# 三个城市核心区 PMTiles（bbox 见 spikes/cities.json）
tools/pmtiles extract https://build.protomaps.com/20261021.pmtiles \
  spikes/map/chongqing-core-z15.pmtiles \
  --bbox=106.42,29.49,106.65,29.63 --maxzoom=15
tools/pmtiles extract https://build.protomaps.com/20261021.pmtiles \
  spikes/map/wuhan-core-z15.pmtiles \
  --bbox=114.22,30.47,114.45,30.65 --maxzoom=15
tools/pmtiles extract https://build.protomaps.com/20261021.pmtiles \
  spikes/map/guiyang-core-z15.pmtiles \
  --bbox=106.55,26.30,106.76,26.66 --maxzoom=15

# 浏览器 A* 需要的路网图副本
mkdir -p spikes/web/data/graphs
cp spikes/data/chongqing-walk.json spikes/data/chongqing-car.json spikes/web/data/graphs/
cp spikes/data/wuhan-walk.json spikes/data/wuhan-car.json spikes/web/data/graphs/
cp spikes/data/guiyang-walk.json spikes/data/guiyang-car.json spikes/web/data/graphs/

.venv-spike/bin/python spikes/scripts/combine_web_data.py
.venv-spike/bin/python spikes/scripts/make_manifest.py
```

## 跑预览

```bash
tools/pmtiles serve spikes/map --port=8090 --cors='*' &
python3 -m http.server 8091 --directory spikes/web &
```

打开：

```text
http://127.0.0.1:8091/preview.html?city=chongqing&route=cq-walk-03&recompute=1
```

- 左侧切换城市/路线；
- 地图来自本地 PMTiles；
- 点击“在浏览器本地重算这条路线”，会用浏览器内的 A* 实际计算，HUD 显示毫秒数；
- `recompute=1` 会自动触发一次浏览器内计算。

### 离线模拟

Chrome 阻断外部 DNS、仅放行本机：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle \
  --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost" \
  --window-size=1440,1000 \
  "http://127.0.0.1:8091/preview.html?city=chongqing&route=cq-walk-03&recompute=1"
```

验证点：没有外部资源请求；本地 PMTiles 照常加载；浏览器 A* 仍返回结果。

## 分发语义验证

```bash
.venv-spike/bin/python spikes/scripts/range_server.py --dir spikes/map --port=8093
curl -H 'Range: bytes=0-1023' -D - -o /tmp/part \
  http://127.0.0.1:8093/chongqing-core-z15.pmtiles
# 期望 206 / Content-Range / CORS；完整下载后比对 manifest SHA-256
```

真实 OSS/COS 上传尚未执行（没有账号凭据）；manifest 与 HTTP 语义已就绪。

## 已知限制

- 底图没有中文标签（缺本地 glyphs/sprites），本轮只验证几何与算路。
- 没有离线 POI 搜索；地图点选是兜底。
- 没有转向限制、坡度/楼梯权重；重庆/贵阳需要后续加强。
- 打车时长为估算，不含实时路况；明显偏保守。
- 本机验证使用 Go/Python 本地服务，不是 Android 内的 Kotlin 服务。
- Android WebView 真机性能、内存、离线包加载尚未验证。

## 数据许可

- OpenStreetMap 数据：© OpenStreetMap contributors，ODbL。
- Protomaps Basemap、MapLibre GL JS：遵循各自开源许可；预览页保留 attribution。
- OSRM 公共实例仅用于开发对照，不作为产品依赖。
