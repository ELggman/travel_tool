# M2.3a · 可选精细底图（z16）

- 日期：2026-10-23
- 状态：重庆精细包已生成；Web + Android 35 arm64 模拟器下载/使用通过
- 目标：地图包不再只有一档固定精度，用户可以在标准包之外下载更细的底图。

## 结果

当前标准重庆包已扩为主城全区：

- z0–15，6407 个瓦片
- 解压后约 78.5 MB，zip 39 MB
- 精细包仍只覆盖核心区

新增重庆精细包（修复后的叠加版）：

- 只包含核心区 **z16，1288 个瓦片**
- 瓦片约 1.3 MB，zip **1.5 MB**
- 复用标准包的 walk/car 路网，不重复下载路网
- 不再替换整张底图，只作为核心区 z16 叠加层

App 里的表现：

- 标准包下载后，出现“核心区精细 · z16”
- 下载后，主城全区 z15 底图始终保留
- 核心区 z16 瓦片叠加在宽底图之上
- 核心区外仍显示主城全区 z15，不会白边/空白
- 删除精细包只移除叠加层，宽底图不受影响
- 历史上那版 7.5 MB“整图替换”精细包会导致核心区外白边，已废弃

## 为什么是 z16，不是 z17

当前使用的 Planetiler 0.10.2 最大只允许 `maxzoom=16`，传 17 会直接报：

```text
Max zoom must be <= 16, was 17
```

所以这一版把“精细”定义为 z16。z17 需要更新 Planetiler 或换切片器，后面再做。

另外，**瓦片变细不等于路线变准**：路线仍来自标准包里的 walk/car 图。精细包只改变底图视觉细节。

## 生成方式

用重庆 OSM PBF + Protomaps Planetiler profile 生成 z16 PMTiles：

```text
chongqing-latest.osm.pbf
  + Protomaps basemap profile
  + clip: 106.42,29.49,106.65,29.63
  + maxzoom=16
→ chongqing-fine.pmtiles (5.0 MB)
```

按 bbox 只导出 z16 ZXY 瓦片，作为核心区叠加层：

```text
pack-source/chongqing-fine/
├── manifest.json
└── tiles/16/...
```

打包：

```bash
cd app
python3 scripts/build_pack_archives.py
# chongqing-fine 1.5 MB
```

MapView 使用两个 source：

- `base`：主城全区 z0–15，始终存在
- `fine`：核心区 z16，只在下载精细包后叠加

## 验证

### Web

1. 下载标准重庆包。
2. 地图包底部出现“精细底图 · z16 / 7.7 MB”。
3. 下载精细包，占用从 78.5 MB 变为 86.2 MB。
4. 地图放大到 z16，建筑和道路细节比标准包更细。
5. 删除精细包，占用回到 78.5 MB，地图回退标准 z15。

### Android 35 arm64

1. 安装 637 KB APK，使用已下载的标准重庆包。
2. 在包服务器填 `http://10.0.2.2:8090`（模拟器）后下载精细包。
3. 缓存 `yanlu-pack-chongqing-fine`：1770 条，其中 z16 瓦片 1288 条。
4. 飞行模式 + 关闭 Wi-Fi/数据，强停重开，精细地图、中文标注和 6.9 km 路线仍正常。

![Web 精细叠加](screenshots/web-fine-overlay.png)

![Web 精细 z16](screenshots/web-fine-overlay-z16.png)

![Android 精细 z16](screenshots/android-fine-z16.png)

![Android 精细离线](screenshots/android-fine-offline.png)

## 已知限制

- 只有重庆有精细包；武汉/贵阳还是标准 z15。
- 精细包复用标准包的 walk/car 路网，路线精度不会因为精细底图自动提高。
- z16 相对 z15 只多一级；更高精度需要 z17+ 切片器。
- 精细包目前仍从本地 pack server 下载，不是 CDN。
- 包服务器 IP 会变化；真机在 App 内“包服务器”里改，当前 Mac IP 可用 `ipconfig getifaddr en0` 查。

## 关键文件

- `app/src/data/packs.ts`：`fine` 元数据
- `app/src/lib/packCache.ts`：standard/fine 两套缓存
- `app/src/lib/tileStore.ts`：按 variant 物化 Blob URL
- `app/src/components/MapView.tsx`：精细缓存 + `maxzoom 16`
- `app/src/components/Sheets.tsx`：精细底图下载/删除 UI
- `app/scripts/build_pack_archives.py`：打包 `<city>-fine.yanlu-pack.zip`
