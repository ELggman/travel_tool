# 沿路 / YANLU · 从展示原型到可用 APK 的技术规划

- 版本：v1.3 · 2026-10-22
- 当前仓库：`index.html`、`screens.html`（静态视觉原型）
- 目标：Android 优先、后续 iOS；**中国国内地图**；在线优先 + 完全离线地图 + 离线重算路线；无中心服务器；同一局域网内实时同步。
- 已确认：**朋友内部使用、暂无上架计划**；首批城市 **重庆 / 武汉 / 贵阳**；允许静态 CDN/对象存储分发离线包；第一版只做步行 + 打车；房主手机保持 App 打开可以接受；后续需要 iOS。
- 三城验证计划：[docs/SPIKE-CITIES.md](SPIKE-CITIES.md)。
- 本文记录规划与验证执行；三城地图/路由 spike 已完成，App 主体尚未开始重构。

---

## 0. 结论先行

1. **地图显示、地点搜索、算路是三件事。** 地图不一定要买商业 API；但既然要求“完全离线地图 + 离线重算”，就不能只考虑瓦片，必须同时准备**离线底图包 + 离线路网/路由引擎**。这已经不是展示层的小改动，而是 v1 的核心能力。
2. **现阶段定为开源栈 A：MapLibre + PMTiles + 本地路由。** 朋友内部使用、暂不上架，因此优先选免费可控、可离线、能为 iOS 复用的方案。中国境内的数据完整度、POI 质量、坐标系统（WGS-84 / GCJ-02 / BD-09）仍要在三城实测；如果数据/路线不达标，再评估高德/百度/腾讯等国内 SDK。
3. **在线优先、离线兜底的前提是“同一套地图数据与坐标系统”。** 现阶段在线与离线都使用同一份 OSM 数据与 WGS-84 坐标；不要在线用高德、离线用 OSM 这种混搭。只有 A 在目标城市明显不达标时，才评估整套切换到 B。
4. **不做线上，最合适的是 Host Session（一台手机当房主）模式。** 房主手机跑局域网服务并广播“附近的行程”，其他人通过附近列表、二维码或手填地址加入；所有修改由房主串行确认后广播。WebView 本身不能监听端口或做 mDNS，所以需要 Capacitor + 原生插件；iOS 后续用 Swift 实现同一协议。
5. **不建议做“搜索附近用户”。** 更可靠、更少隐私问题的方式是发现“附近的行程/同步房间”，再用二维码确认加入。用户搜索会受到前后台限制、Wi-Fi 隔离和身份暴露问题影响。
6. **最大风险已经变成四条：**
   - 重庆/武汉/贵阳的 OSM 数据、POI 与路线质量；
   - 手机端离线重算（尤其还要兼顾 iOS）；
   - 城市包体积与静态 CDN 分发；
   - 局域网发现、后台存活与房主单点。
7. **Git 基线已建立。** 原型、规划、后续 App、原生插件分层管理；APK、签名文件、地图大包不进 Git。
8. **离线包分发方式已确定：静态 CDN/对象存储。** 国内访问优先选阿里云 OSS/腾讯云 COS 等；包只含地图数据，不含用户行程。自定义大陆 CDN 域名可能涉及备案。

---

## 1. 现状与差距

### 1.1 现在的版本

- 单文件 `index.html`：视觉完整，但数据是硬编码的。
- 地图是手绘 SVG：坐标是画布坐标，不是经纬度；路线是装饰性的平滑曲线。
- 时间是演示数据：按顺序加停留时长算出来的，没有真实交通耗时。
- 同行编辑是演示状态：没有网络层、没有设备身份、没有持久化。
- `screens.html` 通过 iframe 展示三个状态，只适合做设计说明，不应打进 APK。

### 1.2 要变成真正能用的 App，缺四层

| 层 | 现在 | 需要 |
|---|---|---|
| 数据层 | 内嵌 JS 数组 | SQLite/IndexedDB、稳定 ID、变更记录、导入导出 |
| 地图层 | 手绘 SVG + 假坐标 | 真实经纬度、地图引擎、路线几何、地点搜索 |
| 协作层 | 假的在线状态 | 设备身份、局域网发现、同步协议、冲突处理 |
| 交付层 | 浏览器打开 | Capacitor Android 壳、权限、后台服务、签名 APK |

### 1.3 建议保留的部分

- 视觉语言：纸张色、朱红、苔绿、宋体标题、时间轴。
- 核心手感：拖起卡片、落点槽、地图路线同时重排、变化提示。
- 信息结构：总览按天 → 某一天路线 + 时间轴。

换掉的是“数据来源”和“运行环境”，不是设计方向。

---

## 2. 关键点一：中国区地图、在线优先与完全离线

### 2.1 需求定义

已确认的产品行为：

| 场景 | 地图 | 路线/距离 | 地点搜索 |
|---|---|---|---|
| 有网络 | 优先在线底图、在线搜索 | 优先实时算路/本地算路 | 在线搜索 |
| 无网络，但已下载离线包 | 本地离线地图 | **本地离线重算** | 本地 POI + 地图点选 |
| 无网络，且没有该区域离线包 | 明确提示“未下载离线地图” | 不假装有路线；可显示粗略估算或阻止新增 | 地图点选/已缓存地点 |
| 同一 Wi-Fi 无互联网 | 本地离线地图 | 本地离线重算 | 本地 POI；局域网协作仍可用 |

两个容易混淆的点：

- “不线上”指**没有业务服务器/账号体系**，不等于地图必须离线。你已允许地图联网，因此可以“在线优先、离线兜底”。
- “离线”通常指**没有互联网**，但同一 Wi-Fi 局域网仍然存在。离线地图 + 局域网协作可以同时工作，这对旅行场景很重要。

离线不是只缓存瓦片：要真正离线重算路线，必须同时有**离线底图、离线路网图、离线搜索数据**。

### 2.2 中国区地图的三个前置问题

#### 1）坐标系

| 坐标系 | 来源 | 说明 |
|---|---|---|
| WGS-84 | GPS、OpenStreetMap | 原始 GPS 坐标；开源栈通常使用 |
| GCJ-02 | 高德、腾讯等 | 国内常见的“火星坐标” |
| BD-09 | 百度 | 百度体系 |

必须选一个内部标准并在边界转换，不能把三种坐标混存：

- 开源栈：内部统一 **WGS-84**，展示/搜索适配器负责转换。
- 国内 SDK 栈：通常内部使用 **GCJ-02**，导入 GPS/OSM 数据时转换。
- 每条地点、每条路线几何都带 `crs` 元数据；转换是近似的，不能来回转换多次。

#### 2）数据质量

中国境内 OSM 的道路、POI、地址完整度不均衡；一线城市可能可用，小城市和景区可能缺失。国内 SDK 的 POI/道路数据通常更好，但离线路线能力、配额和授权条款要逐个确认。

**第一版不要承诺“全国每个城市都一样好”。** 先选 2–3 个目标城市做数据验收（例如北京、上海、成都/杭州），再决定地图栈。

#### 3）合规

如果只是朋友内部使用，风险与公开上架不同；如果要公开分发/上架，地图展示在中国涉及测绘、审图、地图服务资质等要求，不能只用“OSM 免费”来做判断。

- 开源地图栈：技术可控，但公开分发前需要合规确认，不能默认 OSM 底图可以直接商用发布。
- 国内 SDK：合规路径更成熟，但有 key、配额、授权和条款限制。
- 这不是纯技术选型，建议在 Phase 2 前做一个“分发范围 + 地图合规”的确认；本文不构成法律意见。

### 2.3 三条可选技术路线

#### 路线 A：开源可控栈（推荐用于“朋友内部使用 + 技术验证”）

- 地图：MapLibre GL JS + 在线免费底图 / 离线 PMTiles 城市包。
- 路线：本地城市路网图 + 设备内路由（推荐用 TypeScript A* 的 spike，或 GraphHopper/Valhalla）。
- 搜索：在线 Nominatim/Photon + 离线 POI 索引 + 地图点选。
- 优点：免费、离线可控、Web UI 可同时服务 Android/iOS、无需商业 key。
- 缺点：中国数据/POI 质量、合规风险、需要自己做地图包和路由数据管线。

#### 路线 B：国内地图 SDK 栈（推荐用于“公开分发/上架”）

- 高德/百度/腾讯地图 SDK：底图、POI、在线算路、离线地图下载。
- 优点：国内数据与合规路径更成熟，POI 搜索体验好。
- 缺点：key/配额/条款；**必须确认离线算路是否支持步行 + 打车**；如果只支持离线地图、不支持离线重算，就不能单独满足需求；iOS/Android SDK 分别接入，Web UI 复用度下降。

#### 路线 C：在线国内 SDK + 离线开源包（混合）

- 在线用高德/百度，离线用 OSM/PMTiles + 本地路由。
- 优点：在线体验好，离线可控。
- 缺点：两套数据、两套坐标、路线结果不一致，维护成本高。
- **第一版不建议。** 除非确认国内 SDK 完全无法离线重算，且团队能承担坐标/数据一致性工作。

**已选择：路线 A（现阶段）。**

- 朋友内部使用、暂不上架，优先 `MapLibre + PMTiles + 本地路由`。
- 首批用 **重庆 / 武汉 / 贵阳** 验证；结果见 [SPIKE-CITIES.md](SPIKE-CITIES.md)。
- B 不进入第一版；只有 A 在三城验证明显失败（路网大面积缺失、POI 无法用、路线不可接受）时，才评估整套切换 B，或缩小城市范围。
- 无论 A/B，`MapProvider` / `RoutingProvider` 接口都从第一天抽象，避免 UI 绑死供应商。

### 2.4 免费/低成本地图选项

| 方案 | key | 离线 | 中国区注意点 |
|---|---|---|---|
| MapLibre + [OpenFreeMap](https://openfreemap.org/) | 否 | 公共实例允许有限下载（单次 ≤ 3000 瓦片 / 50 MB，最多 4 并发，唯一 UA） | 数据来自 OSM；中国覆盖/POI 需实测；版权标注 |
| MapLibre + PMTiles 城市包 | 否 | 可以 | 需要自建 Planetiler/切片管线；适合按城市下载；ODbL 标注 |
| Leaflet + OSM 官方栅格 | 否 | **不允许**预取/离线 | 官方政策禁止 bulk/offline；只适合纯在线验证 |
| 高德/百度/腾讯 SDK | 是 | 以官方离线能力为准 | 数据/合规更好；需确认离线路线和配额 |
| 自建 OpenFreeMap / Planetiler | 否 | 可以 | 服务器、存储、切片和更新成本 |

**首批城市：重庆、武汉、贵阳。** 三城地形差异大，正好覆盖山地/立体交通、跨江桥隧、隧道/立交三类风险；不要直接外推到全国。

**离线包分发：** 已允许静态对象存储/CDN。建议国内访问用阿里云 OSS / 腾讯云 COS 等对象存储 + HTTPS，只读、开启 CORS 与 Range 请求；包按城市/版本/哈希命名，不存用户数据。自定义大陆 CDN 域名可能涉及备案。测试期也可先用本地 HTTP 服务或 GitHub Releases。

参考：

- [OpenFreeMap](https://openfreemap.org/)
- [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Protomaps Basemaps for MapLibre](https://docs.protomaps.com/basemaps/maplibre)

### 2.5 离线地图包设计

离线包不应只是“一个 PMTiles 文件”，至少包含：

| 内容 | 作用 |
|---|---|
| `basemap.pmtiles` | 矢量底图瓦片 |
| `routing.graph` | 步行/打车路网图（节点、边、权重、道路等级、单行等） |
| `poi.sqlite` / `poi.bin` | 离线 POI 搜索索引（可选但建议） |
| `glyphs/`、`sprites/` | 本地字体与图标，保证离线中文标签正常 |
| `manifest.json` | 包 ID、城市、bbox、版本、大小、SHA-256、生成时间、数据许可 |

**分发方式：**

- 用静态对象存储/CDN 放版本化城市包；它只分发地图数据，不保存用户行程，不是业务后端。
- 建议路径：`packs/<city>/<version>/manifest.json` 与分片文件；文件名带哈希，支持 Range/断点续传。
- 国内优先阿里云 OSS/腾讯云 COS；自定义 CDN 域名可能需备案。测试期用本地 HTTP 或 GitHub Releases 也可以。
- 也可以支持“从本地文件导入地图包”，方便测试或无法联网时更新。
- APK 内只预置一个很小的演示城市包，避免安装包过大；其余按需下载。
- 下载管理：按城市/行程下载、显示大小、仅 Wi-Fi、暂停/续传、校验、版本更新、删除、剩余空间检查。
- 不要尝试把全中国打成一个包；按城市或旅行区域打包。

**在线/离线切换策略：**

1. 有网络：优先在线瓦片/搜索；同时允许后台缓存当前视图。
2. 网络失败或超时：自动回退到本地离线包，UI 明确显示“离线地图”。
3. 未下载该区域：显示覆盖提示和下载入口，不显示空白地图假装正常。
4. 在线与离线的样式尽量同源，避免切换时道路/配色突跳。
5. 路线：本地路由引擎优先用同一份图数据，在线/离线结果保持一致；不要在线一套、离线一套。

### 2.6 离线重算路线

已确认只做 **步行 + 打车（汽车）**，不做公交/地铁。需求是“距离、时间、路线几何”，不是逐向导航。

可选引擎：

| 方案 | iOS 复用 | 说明 |
|---|---|---|
| 预处理城市路网 + TypeScript A*（Web Worker） | 可以 | 与 WebView UI 同栈；需要自建图格式/路由实现；城市级可行，需 spike 验证性能与质量 |
| GraphHopper（Java） | 否 | Android 成熟；iOS 需另选引擎 |
| Valhalla（C++） | 可以 | 跨平台潜力好，但 NDK/ObjC++ 集成与图数据构建较重 |
| BRouter | 否 | Android 离线路由，GPL 许可需要评估 |
| 国内 SDK 离线导航 | 视 SDK | 需确认步行/打车、离线包、授权与配额 |

**推荐先做“预处理城市路网 + TS A*”的 spike**，原因是：

- 未来要 iOS，WebView + TypeScript 路由可以复用；
- 城市级步行/打车图不需要完整导航引擎；
- 在线/离线可共用同一份图，结果一致；
- 不引入路由 API 费用和网络依赖。

Spike 要测：

- 一个中等城市的路网图大小、构建时间、加载时间；
- 1–5 km 步行/打车路线计算耗时（目标 < 300 ms，Web Worker 不阻塞 UI）；
- 单行、步行道、桥、隧道、景区道路的基本正确性；
- 打车时间不含实时路况，明确标注“估算”。

如果 TS A* 的质量/性能不够：

- Android 先用 GraphHopper；
- iOS 后续用 Valhalla 或单独引擎；
- 但要把 `RoutingProvider` 抽出来，别让 UI 依赖具体引擎。

**三城特别风险：**

- **重庆**：山地、立体交通、楼梯/扶梯/隧道密集，距离近不等于好走；步行时间不考虑坡度会偏乐观。
- **武汉**：两江三镇，跨江步行可能非常长；要区分可步行桥梁与仅机动车隧道。
- **贵阳**：山地、隧道、立交多，OSM 覆盖可能弱于前两城，POI 也要重点验收。

样本路线、指标和验收门槛见 [SPIKE-CITIES.md](SPIKE-CITIES.md)。

**路线更新策略：**

- 拖动重排后只重算受影响的 leg；
- 拖动中用上一次几何做预览，松手后再计算；
- 本地结果缓存 `from + to + mode + graphVersion`；
- 超出离线包 bbox 的 leg：提示“超出离线范围”，在线时可下载相邻区域；离线时只能显示估算/阻止。
- 打车模式使用汽车路网，不含实时拥堵；时间标注为估算。

### 2.7 地点搜索与离线 POI

- 在线：开源栈用 Nominatim/Photon；国内 SDK 栈用其 POI 搜索。遵守服务条款。
- 离线：地图点选是必须能力；其次是离线 POI 索引（城市包内）+ 最近/收藏地点。
- 第一版不要求“离线搜遍全城”，但必须支持离线新增一个地图点，否则断网无法调整行程。
- 坐标转换在 provider 边界完成；存储时带 `crs`。

### 2.8 地图上的每日路程呈现

保留现在的时间轴叙事，但地图上的信息分层：

1. **路线层**：当天完整 polyline；拖动时旧路线灰色虚线、新路线珊瑚色虚线。
2. **站点层**：编号圆点 1…n；当前拖动项高亮；名称按缩放/点击显示。
3. **汇总层**：`4.6 km · 步行 1 小时 12 分`，并显示 `本地路线 / 在线路线 / 估算`。
4. **分段层**：底部时间轴显示每段交通方式、距离、耗时；地图上点选后再显示。
5. **变化层**：重排后显示 `+4.2 km` 或 `-0.8 km`，可撤销。
6. **离线层**：离线时地图角落显示“离线地图 · 杭州包 2026-10”，避免用户误以为是在线数据。

绝不把两点直线当作真实步行路线；只能作为“估算”降级显示。

### 2.9 iOS 的影响

iOS 是后续目标，这会影响当前选型：

- **Web 层可复用**：React/Vite + MapLibre GL JS 可以跑在 WKWebView；地图包可通过本地 HTTP 服务/自定义协议读取。
- **路由**：TS A* 或 Valhalla 可在两端复用；GraphHopper/BRouter 是 Android 方案，iOS 需要替代品。
- **同步**：协议和 UI 可复用；原生传输需要 Swift 版的 Bonjour/NSListener + 本地 WebSocket 服务。iOS 的本地网络权限、前台限制比 Android 更严格，仍按“App 打开时同步”设计。
- **合规**：iOS 上架同样需要地图/隐私合规；国内地图 SDK 的 iOS SDK 也要单独接入。
- **离线包**：保持同一套 pack 格式和 manifest，Android/iOS 共用生成管线。

### 2.10 本节决策

1. **分发范围**：朋友内部使用、暂不上架 → 走路线 A。
2. **首批城市**：重庆、武汉、贵阳；先做城市核心区，不做整个行政区。
3. **离线包分发**：允许静态 CDN/对象存储，只放地图数据。
4. **离线包按城市分发**，不做全国单包；APK 只内置一个很小的演示包。
5. **在线/离线统一 OSM 数据、WGS-84 坐标与本地路网图**；不混用高德/OSM。
6. **完全离线重算纳入 v1 范围**，不再当作后续可选项。
7. **下一步先做三城验证**，再决定是否维持 A、缩小范围或整体换 B。

---

## 3. 关键点二：同一局域网内的协作

### 3.1 需求拆解

你描述的是四件事：

1. 发现同组的人/同一趟旅行；
2. 加入一个组；
3. 在同一局域网内实时看到彼此的修改；
4. 不依赖任何线上服务器。

这可以实现，但有几个硬约束：

- WebView 里的 JS **不能**监听 TCP 端口，也不能直接做 mDNS；
- Android 对后台服务、组播、Wi-Fi 扫描有权限和电量限制；
- 很多公共 Wi-Fi 开启了 AP 隔离或禁组播，设备之间根本发现不了；
- 如果所有人不在同一个局域网，或者 App 都被切到后台，实时同步就不成立。

所以需要一个原生网络层，并且产品上要明确“这是同一 Wi-Fi 下的近场协作”。

已确认：**房主手机保持 App 打开可以接受**；第一版按“App 活跃时同步”设计，不承诺锁屏持续实时同步。

### 3.2 推荐拓扑：Host Session（房主会话）

不做全员 P2P mesh，先做一台设备当房主：

```text
房主手机                                      加入者手机
──────────────────────────────────────────────────────────
创建 group + session token
启动本地 WS 服务 + NSD 广播  ←  mDNS 发现 / 二维码  →  看到附近行程
显示二维码 / 6 位口令                             扫码或输入口令
                                                ── hello(baseRev) ─→
          ←──────── 快照 / 缺少的变更 ─────────
          ←──────── 实时 patch / presence ──────→
```

- 房主：负责串行化修改、保存当前状态、向所有成员广播。
- 加入者：本地也保存一份完整行程；断线后可以继续编辑，重连时提交本地变更。
- 房主离开：本次会话结束；加入者手上仍有完整数据，可以导出/重新开房。房主迁移以后再做。

为什么不是 mesh：
多人同时改、任意人掉线、任意人当房主，会让排序、冲突和状态收敛变复杂。先做单房主，产品可用，协议也可控。

### 3.3 发现与加入

**建议不叫“搜索附近用户”，而叫“发现附近的行程”。**

- 房主广播 `_yanlu._tcp` 服务，TXT 里包含：行程名、房主昵称、协议版本、房间短码；**不要把加入密钥放在广播里**。
- 加入者列表显示“京都 · 红叶慢行 / 3 人 / 房主 Momo”。
- 点击后需要口令或扫二维码。二维码内容建议：`yanlu://join?host=192.168.x.x&port=xxxxx&group=...&token=...`（二维码只在现场展示，token 不进入日志）。
- 如果 mDNS 被禁用：提供“手动输入 `IP:端口` + 口令”以及二维码兜底。
- 附近列表只展示房间，不展示完整设备名、手机号等身份信息。

Android 侧需要：

- `NsdManager` 做 DNS-SD 发现与注册；
- `CHANGE_WIFI_MULTICAST_STATE`、`ACCESS_NETWORK_STATE`、`INTERNET`；
- 如果要 Wi-Fi Direct / 扫描类方案，再按 Android 版本申请 `NEARBY_WIFI_DEVICES` / 位置权限；
- 房主使用前台服务 + 常驻通知，避免服务被系统回收；
- 明确告知用户：房主退到后台或锁屏后，会话可能暂停。

### 3.4 同步协议

**v1：房主权威 + 修订号（revision）。**

- 房主状态：`trip`、`revision`、`changeLog`、`members`。
- 加入：客户端发 `hello { deviceId, name, baseRev }`，房主回 `snapshot` 或 `delta(baseRev..rev)`。
- 实时：客户端发操作意图（`reorder_stops`、`upsert_stop`、`delete_stop`、`set_booking` 等），房主校验后分配 `rev` 并广播。
- 确认：客户端收到 `ack {rev}`；失败时回滚或提示。
- 在线状态：`presence { stopId, editing, cursor? }` 广播，用于现在的“阿宁正在看”提示。

**离线编辑：**

- 客户端本地保存“待提交操作 + baseRev”。
- 重连时先同步房主的增量，再提交本地待提交操作。
- 如果 baseRev 落后且没有冲突：直接应用。
- 如果同一字段被双方修改：按字段做 last-writer-wins（带 Lamport/actorId，不依赖手机系统时钟），并在 UI 里提示“Momo 也修改了这一站”，提供撤销/对比。
- 同时对顺序做不同调整是天然冲突：建议房主按“操作到达顺序”应用，保证最终顺序确定，并让客户端看到“顺序已被更新”。

**不要用设备时间戳判断先后**：手机时钟可能不准，且离线后更不可靠。使用 `rev` + Lamport clock + actorId。

**以后是否上 CRDT：**

- 如果多人同时编辑、频繁离线、需要强最终一致，可以换 Yjs/Automerge。
- 原生层仍然只做中继；协议字节由 JS 处理。
- 第一版不建议直接上 CRDT：调试成本高，而且当前场景以“一个人改、其他人看”为主。

### 3.5 原生层怎么接

WebView 不能做房主，所以用 Capacitor 自定义插件，而不是找不稳定的第三方 mDNS 插件。

建议插件接口（概念）：

```ts
interface YanluSyncPlugin {
  startHost(options: { groupId, tripName, displayName }): Promise<{ port, token, qrPayload }>;
  stopHost(): Promise<void>;
  discover(): Promise<NearbySession[]>;       // 或事件流
  join(options: { host, port, token }): Promise<void>;
  leave(): Promise<void>;
  send(message: string): Promise<void>;       // JSON 字符串，原生不解析业务
  addListener('message', cb): Promise<PluginListenerHandle>;
  addListener('peer', cb): Promise<PluginListenerHandle>;
  addListener('error', cb): Promise<PluginListenerHandle>;
}
```

- 原生负责：NSD 注册/发现、TCP/WebSocket 连接、广播、前台服务、token 校验、生命周期。
- JS 负责：快照、操作、冲突、UI。
- 原生不解析行程格式，避免协议在 Kotlin 和 TS 两边重复实现。
- 房主要在后台持续服务时，最好把“状态保存 + 广播”也下沉到原生（或保证 WebView 前台）。第一版可以明确要求“房主保持 App 打开”，用前台服务保活；不要让用户误以为锁屏也能一直同步。

**明文流量问题：**

- 如果让 WebView 直接连 `ws://192.168.x.x`，Android 9+ 默认禁止明文流量，需要 network security config 放行局域网 IP。
- 更稳妥的是让原生插件持有 socket，JS 只通过 Capacitor 调用；这样不用给 WebView 开全局明文权限，也便于统一加密。

### 3.6 安全

局域网不是可信网络。最低要求：

- 每个 session 生成高熵 token；加入必须带 token。
- 二维码里的 token 只展示给现场的人，不写日志、不广播。
- 如果行程内容敏感，对消息做应用层加密（AES-GCM，密钥由二维码中的高熵 secret 派生）；这样即使同 Wi-Fi 有人抓包也看不到明文。
- 不建议在公共/无密码 Wi-Fi 上使用；UI 里给出提示。
- 不做账号体系，因此没有“找回密码”“远程踢人”的云能力；房主可以在会话中移除成员。

### 3.7 失败模式与兜底

| 场景 | 行为 |
|---|---|
| 两台设备不在同一 Wi-Fi | 不能实时同步；各自本地编辑，下次同网再同步 |
| 公共 Wi-Fi 开 AP 隔离 | mDNS 发现失败；二维码/手动 IP 也可能失败；提示切换网络 |
| 房主切后台/锁屏 | 会话可能暂停；前台服务尽量保活，UI 明示（已接受此限制） |
| 房主离开 | 会话结束；所有成员保留本地副本 |
| 成员离线编辑后回来 | 提交待同步操作；冲突时提示 |
| 完全无法连上 | 导出 `.yanlu` 文件/二维码快照，用微信/AirDrop/本地文件互传兜底 |

**重要：** “不做线上”意味着没有云端备份。必须提供本地导出/导入，否则手机丢失或卸载就是数据丢失。

### 3.8 先做技术验证，不要先做 UI

在投入页面改造前，先做三个 spike：

1. **发现 spike**：两台 Android 真机，同一 Wi-Fi，原生 NSD 能否稳定发现；至少测普通家用路由器、手机热点、公共 Wi-Fi（AP 隔离）。
2. **通道 spike**：房主手机跑本地 WS 服务，客户端发一条消息，房主广播给第二个客户端；测 5 台设备、锁屏、切后台。
3. **协议 spike**：两个客户端同时拖拽同一天，验证房主串行、版本号、冲突提示是否可控。

这三个 spike 通过，再决定是否值得投入完整的协作 UI。

### 3.9 iOS 的对应实现（后续）

协议与 Web UI 可以复用，原生传输层需要第二套实现：

- **发现**：iOS 用 Bonjour / `NWBrowser` / `NWListener`；需要在 `Info.plist` 声明 `NSLocalNetworkUsageDescription` 与 Bonjour service types。首次连接会弹本地网络权限。
- **连接**：同样的 token + WebSocket/JSON 协议；Swift 插件实现和 Kotlin 插件一致的接口，TS 协议层不改。
- **前台限制**：iOS 对后台监听更严格；继续按“房主 App 打开”设计，不做锁屏长期服务。
- **地图/离线包**：WKWebView + MapLibre GL JS 可复用；本地地图包需要通过应用内本地 HTTP 服务或自定义协议读取。TS A* 路由可跨端复用；若 Android 选了 GraphHopper，iOS 需要另一套路由实现。
- **合规**：国内地图 SDK 的 iOS SDK、App Store 隐私说明与地图合规要单独处理。
- **验收**：iOS 与 Android 能加入同一房间、互相看到修改；同一份离线包 manifest 与路由结果格式一致。

这意味着：

- 优先选择**跨端可复用**的地图渲染（MapLibre GL JS）和路由方案（TS A* 或 Valhalla）；
- 原生同步协议做成平台无关的 JSON，Kotlin/Swift 只负责传输；
- 不要在没有抽象的情况下把 Android 原生路由引擎写进业务层。

---

## 4. 目标技术栈与仓库结构

### 4.1 推荐栈

| 层 | 选择 | 理由 |
|---|---|---|
| Web 客户端 | Vite + TypeScript + React | 地图、拖拽、状态、路由都成熟；也方便以后做 Web 版 |
| 拖拽 | dnd-kit | 可访问性、移动端、排序动画都比手写 pointer 稳定 |
| 地图 | MapLibre GL JS + 在线底图 / 离线 PMTiles | 开源、可换源；同一套 Web 渲染可复用给 iOS；公开分发前需确认中国地图合规 |
| 算路 | 本地城市路网 + TS A*（首选 spike）；GraphHopper（Android 备选）/ Valhalla（跨端备选） | 在线/离线共用同一份图，避免路由 API 依赖；iOS 可复用 TS A* |
| 搜索 | 在线搜索 + 离线 POI 索引 + 地图点选 | 断网仍能新增地点；国内位置数据质量需实测 |
| 状态 | Zustand 或 Jotai | 轻量，适合本地优先 |
| 本地存储 | SQLite（Capacitor SQLite）优先；Web 开发期用 Dexie | 行程、操作日志、离线队列都需要结构化查询 |
| 原生壳 | Capacitor + Kotlin 插件（后续 Swift） | 复用现有 Web UI，同时能碰 NSD/Socket/前台服务/本地资源服务 |
| 地图包管线 | Planetiler + 路网图构建脚本 + 静态 CDN | 按城市生成 PMTiles / routing graph / POI；包不进 Git |
| 测试 | Vitest + Playwright；坐标往返、黄金路线、包校验、真机矩阵 | 先保证地图数据、路线和协议正确 |
| 打包 | Android Studio / Gradle；后续 Xcode | 生成 debug APK 与 release AAB/APK |

> 也可以继续 vanilla TS，不引入 React；但既然要做数据层、地图、同步、设置等多个界面，组件化会明显降低维护成本。UI 风格继续沿用现有 CSS 变量与版式，不需要换设计语言。

**两个接口必须从第一天就抽象：**

- `MapProvider`：在线瓦片 / 离线包 / 未来国内 SDK，都在这一层切换。
- `RoutingProvider`：本地图 / TS A* / GraphHopper / Valhalla，都返回统一的 `{ geometry, distanceM, durationMin, source }`。

否则一旦选定某个地图/路由实现，后面 iOS 或国内 SDK 切换会把业务层一起拖下水。

### 4.2 目标仓库结构

```text
travel_tool/
├── index.html                  # v0 原型，暂时保留
├── screens.html                # 设计展示页，不进 APK
├── docs/
│   └── PLAN.md                 # 本文
├── app/                        # 真正的前端
│   ├── src/
│   │   ├── features/           # trips / days / map / sync / packs
│   │   ├── components/
│   │   ├── lib/                # schedule, distance, storage, protocol
│   │   ├── styles/
│   │   └── App.tsx
│   ├── public/
│   └── vite.config.ts
├── android/                    # Capacitor 生成的 Android 工程
├── ios/                        # 后续 Capacitor iOS 工程
├── packages/
│   ├── sync-protocol/          # TS 类型 + JSON schema
│   ├── routing/                # TS A* / 图格式 / 坐标工具
│   └── map-pack/               # manifest 类型与校验
├── scripts/
│   ├── build-map-pack.sh       # PMTiles + POI + glyphs
│   ├── build-routing-graph.sh  # OSM → 城市路网图
│   └── fetch-map-pack.sh       # 下载/校验/导入（不进 Git）
├── map-packs/                  # 本机地图包（.gitignore）
├── .gitignore
└── README.md
```

原型文件暂时留在根目录，避免破坏 `screens.html` 的相对引用。新 App 成型后再决定是否移到 `prototype/`。

---

## 5. 数据模型草案

| 实体 | 关键字段 |
|---|---|
| Trip | id, name, city, startDate, endDate, cover, revision, mapPackIds, createdBy, updatedAt |
| Day | id, tripId, date, title, startTime, sortOrder, notes |
| Stop | id, dayId, name, lat, lng, crs, address, placeId, placeSource, arrivalMin, stayMin, sortOrder, booking, notes, updatedBy, lamport |
| Leg | id, fromStopId, toStopId, mode(walk/taxi), distanceM, durationMin, geometry, source, graphVersion, computedAt |
| Booking | id, stopId, title, time, confirmation, status, notes |
| Member | deviceId, groupId, displayName, color, role, lastSeen |
| ChangeLog | rev, actorId, lamport, opType, payload, createdAt |
| MapPack | id, city, bbox, version, sizeBytes, sha256, builtAt, license, minAppVersion |
| PackInstall | packId, version, installedAt, storagePath, status |
| Session | groupId, hostDeviceId, host, port, token, startedAt（临时，不长期保存） |

约束：

- 所有实体使用稳定 UUID，不用数组下标做身份；重排只改顺序。
- 时间存“当天分钟数 + 时区”或 ISO 时间，不存展示字符串。
- 每个 stop 的 `lat/lng/crs` 必须真实；地图点选、搜索、导入都要产出这些值。
- 距离/耗时必须带 `source`：`offline-graph` / `online-route` / `cached` / `estimate`；并记录 `graphVersion`，离线包升级后能让旧路线失效/重算。
- 所有路线几何与地图数据必须在同一坐标系统内；转换发生在 provider 边界，不进入业务逻辑。
- 删除使用 tombstone 或 change log，避免离线同步时“删了又被别人加回来”。
- 预订单独结构化，不要把“13:00 已订”塞在名称里。
- `MapPack` 的版本、哈希、bbox 要进入本地库；行程引用包 ID，不引用文件路径。
- 离线包与路网图必须版本匹配；不能拿 A 版本地图配 B 版本路网。

日程重算规则（延续现在的逻辑，但用真实数据）：

1. 从当天开始时间出发；
2. 每个 stop 加停留时长；
3. 每段加真实/缓存的交通时长；
4. 如果 booked 时间与计算结果冲突，显示提醒，而不是偷偷改预订；
5. 拖动后只重算受影响的 leg 和后续时间。

---

## 6. 路线图

### Phase 0 · 基线与规划（现在）

- Git 初始化、`.gitignore`、README、本规划；
- 保留现有原型作为视觉参考；
- 锁定已确认约束：中国区、在线优先 + 完全离线、步行/打车、Android 优先后 iOS、房主保持 App 打开；
- 明确分发范围、目标城市与群组规模。

**完成标志：** 仓库可追溯，后续每个阶段都有明确验收标准。

### Phase 1 · 真正的行程数据与编辑（约 1.5–2.5 周）

- Vite + TS + React 脚手架，迁移设计 token；
- 数据模型、SQLite/Dexie、本地持久化；
- 新增/编辑/删除地点、日期、预订、备注；
- 拖拽重排、日程重算、撤销；
- 用 1 个国内城市样例行替代京都演示数据（视觉可保留）；
- 不接地图，先用固定测试坐标/手动输入坐标，验证编辑闭环。

**验收：** 刷新/重启后行程还在；改顺序后时间正确；新增预订能看到冲突提示；没有地图也能完整编辑；国内城市样例行可运行。

### Phase 2 · 地图底座与中国区数据验证（约 2–3 周）

- 抽象 `MapProvider` / `RoutingProvider`；
- MapLibre GL JS + 在线底图，接入真实经纬度与地图点选；
- 用 **重庆、武汉、贵阳** 验证 OSM 数据、路网、POI 与路线质量；
- 明确内部坐标系（WGS-84 或 GCJ-02）与转换边界；
- 画第一条真实路线（在线或本地初步路由均可），验证拖动重排后的局部更新；
- 确认三城核心区范围（重庆尤其不要一上来覆盖整个行政区）。

**验收：** 三城各至少 5 个真实地点能正确落图并连线；坐标无漂移；形成三城数据/路线/包体积报告；明确是继续开源栈、缩小范围还是换国内 SDK。

### Phase 3 · Android 壳与首个 APK（约 3–5 天）

- Capacitor 接入，生成 `android/`；
- 全屏/安全区、状态栏、返回键；
- 应用名、图标、包名、竖屏锁定；
- 本地资源服务（后续同时服务离线地图包和局域网同步）；
- debug APK 真机安装；权限与网络检查。

**验收：** APK 可安装；返回键从 Day 回总览；拖动中返回先取消；没有系统状态栏/浏览器栏冲突；断网可编辑；地图包文件可由 WebView 读取。

### Phase 4 · 离线地图包与离线重算（约 3–5 周，核心）

- 按城市生成 `basemap.pmtiles`、路网图、POI 索引、glyphs/sprites、manifest；首批重庆/武汉/贵阳核心区；
- 静态 CDN/对象存储：版本化路径、CORS、Range、SHA-256 校验、断点续传；
- 地图包下载管理：Wi-Fi、大小、校验、版本、删除、存储检查；
- 在线优先 / 离线自动回退；
- 本地路由：优先实现 TS A*（步行 + 打车）并放入 Web Worker；
- 拖动后局部重算，缓存路线；离线范围提示；
- 飞行模式验收；
- 性能：中端 Android、连续拖动、100 个点、城市包加载。

**验收：** 开飞行模式，在重庆/武汉/贵阳任一已下载城市中能看地图、点选地点、拖动重排、重新计算步行/打车路线与里程；未下载区域有明确提示；在线恢复后能继续使用在线底图；包版本与路线来源可追踪；三城至少各 8/10 样本路线合理。

### Phase 5 · 局域网协作 MVP（约 2–4 周）

- Kotlin 插件：NSD 注册/发现、本地 WS 服务、前台服务、token；
- 房主/加入 UI、附近行程列表、二维码、手动 IP；
- 快照 + 修订号 + 操作广播；
- 离线队列与重连；
- presence（谁在看哪一天）；
- 两台真机、三台真机、热点、公共 Wi-Fi、无互联网 Wi-Fi 的测试矩阵。

**验收：** 两台手机同一 Wi-Fi（可以没有互联网），10 秒内发现并加入；修改 1 秒内出现在另一台；离线修改重连后可合并；房主离开有明确提示且不丢本地数据；离线地图 + 局域网协作同时可用。

### Phase 6 · iOS 移植（约 3–5 周，Android v1 之后）

- Capacitor iOS 工程；
- Swift 同步插件：Bonjour/NWListener、本地网络权限、前台限制；
- 复用 Web UI、离线包格式与 TS 路由；
- 如果 Android 用了 GraphHopper，补一套 iOS 路由或改用跨端方案；
- iOS 地图合规/隐私说明；
- 测试与 Android 互通。

**验收：** iOS 与 Android 可加入同一房间；同一份城市包可用；同样的重排与路线结果；iOS 本地方案符合上架要求。

### Phase 7 · 发布准备（约 1–2 周）

- release keystore / Apple 签名（均在仓库外）；
- versionCode/versionName；
- APK/AAB、安装包体积；
- 隐私说明（局域网权限、地图请求、数据只在本机）；
- 备份/导出/导入；
- 崩溃与日志策略；
- 用户测试与发布检查表。

### 最小可用版本（MVP）边界

建议把第一版 MVP 定义为：

- **Android**，重庆/武汉/贵阳核心区（可下载离线城市包）；
- 在线优先 + **完全离线地图 + 离线重算步行/打车路线**；
- 1 趟旅行、最多 7 天、每天最多 10 个点、2–6 人；
- 真实坐标、路线几何、每日里程/耗时、来源标记；
- 本地持久化 + 拖拽重排 + 预订 + 撤销；
- 同一 Wi-Fi、房主 App 打开时实时同步；
- 可安装的 debug APK；
- **不包含**：iOS 首发、公开上架合规、公交/地铁、照片同步、账号、云端备份、全中国单包、离线全城 POI 搜索。

周期判断：在上述边界下，Android 第一版大约 **10–16 周**（一人、熟悉 TS/Android；含地图包管线和两个 spike 的学习成本）。如果坚持公开上架、采用国内 SDK 且其离线路线能力需要额外授权，或 TS A* 不可行、要接原生路由引擎，周期会再增加。本文不把 10–16 周当作承诺，而是排期基线。

## 7. 风险与待确认

### 7.1 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 三城 OSM 数据/POI 质量 | 路线不可用、离线搜索弱 | 先做三城 spike；地图点选兜底；不达标再评估国内 SDK 或缩小范围 |
| 坐标混用 | 点位偏移、路线错位 | 内部统一 CRS；provider 边界转换；往返测试 |
| 离线重算路线 | 需求核心，但不能靠在线 API | 本地城市路网 + TS A* spike；备选原生路由；只承诺步行/打车 |
| 离线包体积/分发 | 手机存储、下载失败 | 按城市核心区分包；静态 CDN/OSS/COS；校验/暂停/续传/删除；单城目标 ≤200MB |
| 地图包与路网版本不一致 | 路线穿过新路/旧桥 | manifest 绑定版本；版本变化使旧路线失效并重算 |
| iOS 路由不可复用 | 两端行为不一致 | TS A* 或 Valhalla 优先；`RoutingProvider` 抽象；iOS 插件单独验收 |
| 局域网组播被禁 | 发现失败 | 二维码/手动 IP 兜底；多种网络测试矩阵 |
| Android/iOS 后台限制 | 房主掉线 | 前台服务；UI 明示“App 打开时同步”；已接受此限制 |
| 并发拖动冲突 | 顺序不确定/数据错乱 | 房主串行、稳定 ID、rev/Lamport、冲突提示 |
| 没有云端备份 | 手机丢失即丢失 | 本地导出/导入；定期备份提醒；`.yanlu` 文件 |
| WebView 地图/离线包读取性能 | 拖动卡顿、加载慢 | 早做 spike；Web Worker；本地资源服务；必要时原生地图 |
| 明文局域网传输 | 隐私泄露 | token + 应用层加密；不信任公共 Wi-Fi |
| 范围膨胀 | 交付延期 | 严格 MVP；iOS/公交/照片/公开上架分阶段 |

### 7.2 决策状态

#### 已确认

1. **分发范围：朋友内部使用，短周期内不上架。** 因此第一版走开源栈 A，不做公开上架的合规工程。
2. **地图与算路允许联网**，但必须支持完全离线地图与离线重算；在线优先，离线自动回退。
3. **第一版只做中国国内地图**；首批城市：**重庆、武汉、贵阳**；先做城市核心区，不做整个行政区。
4. **第一版只做步行 + 打车**，不做公交/地铁。
5. **Android 优先，后续 iOS**；代码/协议/离线包格式要为 iOS 留出复用空间。
6. **房主手机保持 App 打开可以接受**；实时同步定位为“同一局域网 + App 活跃”。
7. **离线包分发允许静态 CDN/对象存储**；只放地图数据，不放用户行程；国内优先 OSS/COS。

#### 仍需确认

1. **群组规模与使用频率**：2–6 人、旅行期间同步，和 20 人长期协作，是两种协议。
2. **照片/票据是否同步**：推荐 v1 只同步结构化行程，照片本地保存，后续再做局域网传输。
3. **应用名/包名**：暂定「沿路」/ `com.yanlu.travel`；越早定越好。
4. **三城核心区 bbox**：尤其重庆，需要明确离线包覆盖到哪些区，避免包过大。
5. **三城 spike 结果**：若 OSM 路线质量不达标，是缩小范围、接受更多“地图点选/估算”，还是整体切换国内 SDK。
6. **静态包托管商**：阿里云 OSS / 腾讯云 COS / 其他；是否需要自定义域名（大陆 CDN 域名可能涉及备案）。

## 8. Git 与版本控制

本次已建立仓库基线。约定如下：

- 主分支：`main`；
- 功能分支：`feat/map-engine`、`feat/offline-maps`、`feat/lan-sync`、`feat/android-shell`、`feat/ios-shell`；
- 提交信息用前缀：`feat:`, `fix:`, `docs:`, `chore:`, `test:`；
- 原型打标签 `v0.1-prototype`；
- 大文件不进 Git：`*.apk`、`*.aab`、`*.jks`、`*.keystore`、`*.pmtiles`、`*.mbtiles`、`*.osm.pbf`、`map-packs/`、`graph-cache/`；
- 地图包通过脚本下载并校验（SHA-256），放在本机/对象存储/Release assets；
- 签名文件只放本机安全位置或 CI secret，绝不提交；
- 后期可用 GitHub Actions 构建 Web 与 Android；APK 作为构建产物，不靠 Git 传输；
- 若之后需要小体积测试地图包，再引入 Git LFS，不要直接把二进制塞进普通提交。

常用命令：

```bash
git status
git switch -c feat/map-engine
git add app/src/features/map
git commit -m "feat(map): render routed polyline for a day"
git push -u origin feat/map-engine
```

---

## 9. 执行记录与建议的下一步

### 2026-10-22 · 第一轮三城 Spike

- 已完成：三城核心区离线 PMTiles、OSM 路网、步行/打车图、本地 A*、浏览器内 A*、断外网加载、CDN manifest/Range 验证。
- 结果：30/30 路线可计算，28/30 与 OSRM 距离误差 ≤10%，29/30 ≤20%；条件通过，继续开源栈 A。
- 详细报告：[docs/spikes/city-map-report.md](spikes/city-map-report.md)。
- 仍需修正：`cq-walk-08`、`wh-taxi-07`、`gy-taxi-06` 等异常路线；打车时长标定；离线中文标签；转向限制/坡度。
- 2026-10-22 Android 壳：JDK 21 + SDK 35 + 手工 aapt2/d8/apksigner 构建 APK；Android 35 arm64 模拟器通过三城/离线/A*，冷启动 971 ms，PSS 126.6 MB；物理真机待连接。

### 下一步

第一轮三城验证已经完成，不再重复做“三城数据包/离线重算”的可行性判断。接下来按以下顺序推进：

1. **修正异常路线**：人工复核 `cq-walk-08`（来福士→洪崖洞，−21.9%）、`wh-taxi-07`（光谷→武汉大学，+12.1%）、`gy-taxi-06`（喷水池→观山湖，−9.4%），补缺失连接/转向限制，再跑同批样本。
2. **补齐离线体验**：本地 glyphs/sprites + 中文道路/地名标签；打包城市 POI 索引（SQLite FTS 或紧凑二进制），支持断网搜索与地图点选兜底。
3. **标定时间**：按城市/道路等级校准步行与打车速度；在 UI 明确“估算、不含实时路况”；重庆/贵阳加坡度/楼梯提示，避免把算法时间当成承诺。
4. **Android 真机 proof**：Capacitor 壳 + Kotlin 本地 HTTP 服务（PMTiles/图数据） + WebView 内 Web Worker A*；测 3 个城市包的加载、内存、首条路线耗时和断网切换。
5. **局域网同步 spike**：两台 Android 真机，原生 NSD + 本地 WebSocket 做“发现 → 加入 → 一条消息广播”，覆盖家用路由器、手机热点、公共 Wi-Fi、无互联网 Wi-Fi；再决定 Host Session 的最终协议。
6. 上述通过后进入 Phase 1：Vite/React 工程、数据模型、本地存储、编辑闭环；随后尽早做只读 APK 壳。
7. Android 第一版稳定后再移植 iOS；不要在路由/同步尚未稳定时同时开 iOS。

**当前阶段开始需要 JDK/Android SDK 做真机验证，但不在未确认前直接出可分发 APK。** 三城报告已给出“条件通过”，下一步重点是把异常路线和离线标签补到可演示质量。

### 参考链接

- [OpenFreeMap](https://openfreemap.org/)
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Protomaps Basemaps for MapLibre](https://docs.protomaps.com/basemaps/maplibre)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Capacitor](https://capacitorjs.com/docs)
- [OSRM](https://project-osrm.org/)
- [Valhalla](https://valhalla.github.io/valhalla/)
- [GraphHopper](https://www.graphhopper.com/open-source/)
- [Planetiler](https://github.com/onthegomap/planetiler)
- [Protomaps PMTiles](https://docs.protomaps.com/pmtiles/)
- [Android NsdManager](https://developer.android.com/reference/android/net/nsd/NsdManager)
- [高德开放平台](https://lbs.amap.com/)
- [百度地图开放平台](https://lbsyun.baidu.com/)
