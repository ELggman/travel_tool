# 沿路 App · M2.1

M2.1 把 M1 的“本地演示下载”换成了**真实城市包归档下载 + 本机缓存 + 删除释放 + 离线读取**，同时保留 M1 的省份/城市主题和单日行程编辑。

## 已实现

### 真实地图包

- 城市包是独立归档：`<city>.yanlu-pack.zip`
  - 重庆 9.7 MB、武汉 11.4 MB、贵阳 5.7 MB（压缩后）
- App 基座不再内置三城地图包：APK 从 26 MB 降到 **549 KB**
- 下载：`fetch` 归档（带进度）→ `fflate` 解压 → 写入 **CacheStorage**
- 删除：`caches.delete('yanlu-pack-<city>')`，真正释放缓存；同时 revoke 该城市的 Blob URL
- 首启：没有缓存时进入“先下载一座城市”；下载后进入行程
- 地图：CacheStorage 中的 MVT 转 Blob URL，通过 MapLibre `transformRequest` 注入
- 路由：主线程从 CacheStorage 读取 graph，交给 Web Worker A*
- 包管理：重庆 / 武汉 / 贵阳可下载；哈尔滨为“准备中”占位；显示体积、状态、占用空间

### 可选精细底图

- 重庆标准包（主城全区 z15，39 MB zip）之外，可单独下载 **核心区 z16 精细叠加层**（1.5 MB zip）
- 精细层只叠加核心区 z16，主城全区 z15 底图始终保留；下载/删除/占用单独管理
- 核心区放大到 z16 时使用精细层，核心区外仍用主城全区底图；删除只移除叠加层
- 当前只有重庆有精细包；武汉/贵阳仍是核心区标准包

### 行程编辑（M1 延续）

- 单日行程：添加/删除地点、修改停留、步行/打车切换、拖动排序
- 路线、到达/离开时间实时重算
- 出发时间、预订备注
- 行程、顺序、交通方式、当前城市写入 localStorage
- 中文道路/地点/POI 标注（本地 glyphs + 系统 CJK 字体），按城市主题配色
- 按城市切换主题、地图配色、标题与印章

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

## 本地包服务器

城市包归档不随 App 打包；需要单独启动：

```bash
cd app
python3 scripts/pack_server.py --port 8090
```

- 浏览器：`http://127.0.0.1:8090`
- Android 模拟器：`http://10.0.2.2:8090`
- 物理手机：在地图包底部“包服务器”填 `http://<Mac-IP>:8090`，或构建时设 `VITE_PACK_BASE_URL`；不需要科学上网
- 环境变量/查询参数：`VITE_PACK_BASE_URL`，或 `?packBase=http://...`
- 生产替换为 OSS/COS：`https://<cdn>/packs/<city>.yanlu-pack.zip`

### 真机下载卡在 1%

真机不能用模拟器的 `10.0.2.2`。查 Mac IP、启动 pack server、手机浏览器先验证，再在 App 内改地址；详见 [排查记录](../docs/m2/troubleshooting/README.md)。

### 重新生成归档

`pack-source/` 是解压后的城市资源（不入 Git），归档生成：

```bash
cd app
python3 scripts/build_pack_archives.py
# 输出 pack-server/packs/<city>.yanlu-pack.zip
```

`pack-source/<city>` 结构：

```text
manifest.json
walk.json
car.json
tiles/<z>/<x>/<y>.mvt   # gzip MVT；下载时解压为原始 MVT 后缓存
```

原始三城资源仍由 PMTiles extract + OSM graph 流水线生成，见 [三城报告](../docs/spikes/city-map-report.md)。

## 结构

```text
src/
├── App.tsx                 # 首启、包下载/删除、行程编辑、持久化
├── components/
│   ├── MapView.tsx         # MapLibre + Blob 瓦片 + route GeoJSON + markers
│   └── Sheets.tsx          # 地图包 / 加地点 / 编辑地点
├── data/
│   ├── packs.ts            # 省份、城市、主题、种子行程、包元数据
│   └── places.generated.ts
├── lib/
│   ├── packCache.ts        # 归档下载、CacheStorage、校验、删除
│   └── tileStore.ts        # CacheStorage → Blob URL
├── hooks/useRouting.ts     # 缓存 graph → worker A*
├── routing/worker.ts
└── config.ts               # PACK_BASE_URL
```

## M2.1 边界

- 只做单日行程；多日、真实航班/酒店表单还没做。
- 添加地点仍用每城 8–11 个精选地点，没有离线 POI 搜索/地图点选。
- 归档还没有 SHA-256 校验、断点续传、暂停/取消、配额淘汰。
- 省级聚合包、包版本更新/差分未做。
- 包服务器目前是本机 Python；OSS/COS/CDN 上传未做。
- 物理真机上的下载/缓存还没验证；当前 Android 结果来自模拟器。
- 中文标注没有 POI 图标 sprites；低缩放只显示少量区级标签，放大后才显示更多道路/POI。
- 精细底图目前只到 z16；Planetiler 0.10.2 不支持 z17。
- 重庆标准包已扩到主城全区，但不是整个重庆市。
- 精细底图不影响路线精度，路线仍来自标准 walk/car 图。

## 验证

Web + Android 35 arm64 模拟器已验证：

- 清空缓存进入首启；
- 下载重庆归档 → 484 个缓存条目 → 地图/路线 6.9 km；
- 停掉 pack server 后刷新/重开仍可用；
- 下载武汉 → 湖北主题/11.1 km → 删除后缓存只剩重庆；
- 首启、下载、离线截图见 [M2.1 记录](../docs/m2/README.md)。
