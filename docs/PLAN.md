# 沿路 / YANLU · 从展示原型到可用 APK 的技术规划

- 版本：v1.0 · 2026-10-22
- 当前仓库：`index.html`、`screens.html`（静态视觉原型）
- 目标：可安装的 Android APK；无中心服务器；编辑与协作都尽量本地化；同一局域网内实时同步。
- 本文只做规划，不开始改版实现。

---

## 0. 结论先行

1. **地图不一定要调用商业地图 API。** 地图显示可以用开源的 MapLibre 或 Leaflet，底图用免费的 OpenFreeMap / Protomaps / 自托管 OSM 数据；真正需要额外服务的是“地点搜索”和“算路”，这两件事要和地图显示分开做。
2. **每日路程必须来自路线几何，而不是两个标记点之间的直线。** 第一版建议允许联网获取路线并缓存；断网时展示缓存或明确标注“直线估算”。如果把“完全离线地图 + 离线重算路线”当作硬指标，复杂度会显著上升，建议放到后续阶段。
3. **不做线上，最合适的是 Host Session（一台手机当房主）模式。** 房主手机跑局域网服务并广播“附近的行程”，其他人通过附近列表、二维码或手填地址加入；所有修改由房主串行确认后广播。WebView 本身不能监听端口或做 mDNS，所以需要 Capacitor + 原生 Kotlin 插件。
4. **不建议做“搜索附近用户”。** 更可靠、更少隐私问题的方式是发现“附近的行程/同步房间”，再用二维码确认加入。用户搜索会受到前后台限制、Wi-Fi 隔离和身份暴露问题影响。
5. **现在就应该建立 Git 基线。** 原型、规划、后续 App、原生插件分层管理；APK、签名文件、地图大包不进 Git。
6. **最大风险不是 UI，而是两条线：**  
   - 离线地图与离线算路；  
   - Android 局域网发现 + 后台存活的限制。

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

## 2. 关键点一：地图与每天的路线数据

先把问题拆开，不然后面会把“地图”当成一个整体采购：

| 子问题 | 需要什么 | 是否必须商业 API |
|---|---|---|
| 显示底图 | 瓦片、样式、字体、版权标注 | 否 |
| 把地点变成坐标 | 地点搜索/地理编码，或手动在地图上点选 | 否，但免费服务有使用限制 |
| 画路线 | 路线几何（polyline），或直连近似线 | 否，但真实路线需要算路 |
| 算距离/耗时 | 路由引擎 | 否，但离线算路另算 |
| 预订信息 | 自己的业务数据 | 不需要地图 API |

### 2.1 免费底图方案对比

| 方案 | 是否要 key | 离线 | 成本 | 适合 |
|---|---|---|---|---|
| Leaflet + OSM 官方栅格瓦片 | 否 | **不允许**批量/离线缓存 | 免费，但必须遵守使用政策 | 最快验证、纯在线小工具 |
| MapLibre GL JS + OpenFreeMap 公共实例 | 否 | 允许小范围下载（单次 ≤ 3000 瓦片 / 50 MB，最多 4 并发，需唯一 UA） | 公共实例免费，无注册、无用户库、无 cookie | **第一版首选** |
| MapLibre + Protomaps / PMTiles | 否 | 可以，瓦片是单个归档文件 | 软件开源；存储/流量自付，可自托管 | 完全离线、按行程打包 |
| MapTiler / Stadia / Mapbox / Google Maps | 是 | 依套餐 | 有免费额度，超出计费 | 需要商业 SLA 或高级样式时 |
| 自建 OpenFreeMap / Planetiler | 否 | 可以 | 服务器与运维成本 | 用户量变大、需要完全控制 |

参考：

- [OpenFreeMap](https://openfreemap.org/)：公开实例免费、无 API key；离线下载限制和版权要求见其页面。
- [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)：官方栅格瓦片禁止预取/离线包，必须带版权标注和可识别 User-Agent。**不要拿 `tile.openstreetmap.org` 做“下载离线地图”功能。**
- [Protomaps Basemaps for MapLibre](https://docs.protomaps.com/basemaps/maplibre)：PMTiles 与 MapLibre 的离线/自托管方案。

**推荐组合：**

- **v1（在线底图）**：MapLibre GL JS + OpenFreeMap 公共实例，保留现在的地图视觉倾向，地图上必须显示 “© OpenStreetMap contributors / OpenFreeMap / OpenMapTiles” 等版权信息。
- **v1.5（按行程离线）**：为每趟旅行生成/下载一个 PMTiles 区域包（例如京都或某个城市），存到 App 文档目录；打开行程时优先读本地包。地图字体、图标（glyphs/sprites）也要本地化，否则离线时中文标签会消失。
- **v2（完全离线且要实时重算路线）**：需要把路由引擎也搬到设备上，或提前缓存所有可能顺序的路线。这是另一个项目量级，先不要放进 MVP。

### 2.2 “每天的路程数据”怎么标

建议保留现在的时间轴叙事，但地图上的信息分层：

1. **路线层**：当天按顺序的完整 polyline，1.5–3 px，带白描边；拖动时旧路线灰色虚线、新路线珊瑚色虚线。
2. **站点层**：编号圆点 1…n，当前拖动项高亮；不把每个点的完整名称都挤在地图上，按缩放级别或点击再显示。
3. **汇总层**：地图左下角一块深色小条，例如 `4.6 km · 步行 1 小时 12 分`；明确写出“已算路”还是“估算”。
4. **分段层**：每一段在底部时间轴里显示“步行 15 分钟 · 1.1 km”；地图上只在点击某段或放大到较高 zoom 时显示距离标签。
5. **变化层**：拖动重排后，若总里程变化，显示 `+4.2 km` 这样的差值，并提供撤销。

不要让“路线”变成两个站点之间的直线然后宣称这是步行距离。直线距离只能作为降级显示，且必须标注“估算”。

### 2.3 路线怎么算

| 方案 | 说明 | 适合 |
|---|---|---|
| 直连/平滑曲线 + Haversine × 系数 | 不依赖服务，最快；只能做视觉与粗略估算 | 离线降级、原型 |
| 自建 OSRM / Valhalla / GraphHopper | 开源路由引擎，数据来自 OSM；可算步行/骑行/驾车，公交需要额外数据 | 需要长期稳定、可控成本 |
| 免费额度 API（OpenRouteService、GraphHopper 等） | 有 key、有额度和条款；上线前要确认 | 小规模早期 |
| OSRM 公共 demo | 只适合开发联调，不能作为生产依赖 | 开发阶段 |
| 设备内路由（BRouter 等） | 完全离线，但集成与数据包管理复杂 | 后续硬需求 |

**v1 策略：**

- 用户在线规划时，用路由服务计算每一段，缓存 `geometry / distance / duration / mode / source / computedAt`。
- 拖动重排后，只重算受影响的段；不是整天的所有段都重算。
- 断网时：能命中缓存的段直接用；不能命中的段画平滑估算线，标注“估算”，并允许之后联网刷新。
- 去重与缓存键：`fromStopId + toStopId + mode + routingProfile`，同一对站点复用。
- 若拖动过程中频繁算路，使用 debounce（300–500 ms），拖动时先画几何预览，松手后再发请求。

这样能保住现在“拖动时路线跟着变”的手感，又不会把整个编辑流程绑死在地图服务上。

### 2.4 公交/地铁

这是比步行路线更复杂的一层：

- 需要 GTFS 或 GTFS-RT 数据，通常用 OpenTripPlanner 自建。
- 不能只靠普通道路路由引擎。
- 如果要显示“几点坐哪班车”，还要处理时刻表、换乘、延误。

建议 MVP 只承诺 **步行 + 打车/驾车** 两种模式，公交放到后续版本，避免第一版无法交付。

### 2.5 地点搜索与坐标来源

真实使用必须有经纬度，不能再使用画布坐标。

优先级建议：

1. **地图点选**：用户长按地图新增一个点，最可靠、离线也成立。
2. **在线地点搜索**：Nominatim / Photon 等开源地理编码服务，遵守公共实例的使用政策；生产环境最好自托管。
3. **导入**：支持粘贴 Google Maps/高德/OSM 链接，或导入 GPX/KML；解析失败时退回地图点选。
4. **离线 POI 包**：如果完全离线，需要按城市打包 POI 搜索索引；这是额外的数据工程。
5. **手动输入经纬度**：作为兜底。

地点搜索只发送搜索词，不把整份行程上传到第三方。

### 2.6 本节建议的决策

- **v1 允许地图与算路联网，但行程本身与协作不依赖云。** 地图/路线缓存到本地，断网仍能打开和编辑。
- **完全离线地图放到 v1.5；完全离线实时算路放到 v2。**
- 地图底图用 MapLibre + OpenFreeMap；如果 WebView 性能不佳，再退回 Leaflet + 合规瓦片源。

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
| 房主切后台/锁屏 | 会话可能暂停；前台服务尽量保活，UI 明示 |
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

---

## 4. 目标技术栈与仓库结构

### 4.1 推荐栈

| 层 | 选择 | 理由 |
|---|---|---|
| Web 客户端 | Vite + TypeScript + React | 地图、拖拽、状态、路由都成熟；也方便以后做 Web 版 |
| 拖拽 | dnd-kit | 可访问性、移动端、排序动画都比手写 pointer 稳定 |
| 地图 | MapLibre GL JS + OpenFreeMap；离线用 PMTiles | 开源、无 key、可换源 |
| 状态 | Zustand 或 Jotai | 轻量，适合本地优先 |
| 本地存储 | SQLite（Capacitor SQLite）优先；Web 开发期用 Dexie | 行程、操作日志、离线队列都需要结构化查询 |
| 原生壳 | Capacitor + 自定义 Kotlin 插件 | 复用现有 Web UI，同时能碰 NSD/Socket/前台服务 |
| 测试 | Vitest + Playwright；原生插件用真机手动矩阵 | 先保证协议和地图数据正确 |
| 打包 | Android Studio / Gradle | 生成 debug APK 与 release AAB/APK |

> 也可以继续 vanilla TS，不引入 React；但既然要做数据层、地图、同步、设置等多个界面，组件化会明显降低维护成本。UI 风格继续沿用现有 CSS 变量与版式，不需要换设计语言。

### 4.2 目标仓库结构

```text
travel_tool/
├── index.html                  # v0 原型，暂时保留
├── screens.html                # 设计展示页，不进 APK
├── docs/
│   └── PLAN.md                 # 本文
├── app/                        # 真正的前端
│   ├── src/
│   │   ├── features/           # trips / days / map / sync
│   │   ├── components/
│   │   ├── lib/                # schedule, distance, storage, protocol
│   │   ├── styles/
│   │   └── App.tsx
│   ├── public/
│   └── vite.config.ts
├── android/                    # Capacitor 生成的 Android 工程
├── packages/
│   └── sync-protocol/          # 可选：TS 类型 + JSON schema
├── scripts/
│   └── fetch-map-pack.sh       # PMTiles 区域包下载/裁剪（不进 Git）
├── .gitignore
└── README.md
```

原型文件暂时留在根目录，避免破坏 `screens.html` 的相对引用。新 App 成型后再决定是否移到 `prototype/`。

---

## 5. 数据模型草案

| 实体 | 关键字段 |
|---|---|
| Trip | id, name, city, startDate, endDate, cover, revision, createdBy, updatedAt |
| Day | id, tripId, date, title, startTime, sortOrder, notes |
| Stop | id, dayId, name, lat, lng, address, placeId, arrivalMin, stayMin, sortOrder, booking, notes, updatedBy, lamport |
| Leg | id, fromStopId, toStopId, mode, distanceM, durationMin, geometry, source, computedAt |
| Booking | id, stopId, title, time, confirmation, status, notes |
| Member | deviceId, groupId, displayName, color, role, lastSeen |
| ChangeLog | rev, actorId, lamport, opType, payload, createdAt |
| Session | groupId, hostDeviceId, host, port, token, startedAt（临时，不长期保存） |

约束：

- 所有实体使用稳定 UUID，不用数组下标做身份；重排只改顺序。
- 时间存“当天分钟数 + 时区”或 ISO 时间，不存展示字符串。
- 距离/耗时必须带 `source`：`routed` / `cached` / `estimate`。
- 删除使用 tombstone 或 change log，避免离线同步时“删了又被别人加回来”。
- 预订单独结构化，不要把“13:00 已订”塞在名称里。
- 每个 stop 的 `lat/lng` 必须真实；地图点选、搜索、导入都要产出这两个值。

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
- 明确地图在线/离线、平台、群组规模等决策。

**完成标志：** 仓库可追溯，后续每个阶段都有明确验收标准。

### Phase 1 · 真正的行程数据与编辑（约 1.5–2.5 周）

- Vite + TS + React 脚手架，迁移设计 token；
- 数据模型、SQLite/Dexie、本地持久化；
- 新增/编辑/删除地点、日期、预订、备注；
- 拖拽重排、日程重算、撤销；
- 不接地图，先用假坐标或点选坐标，验证编辑闭环。

**验收：** 刷新/重启后行程还在；改顺序后时间正确；新增预订能看到冲突提示；没有地图也能完整编辑。

### Phase 2 · 真实地图与每日路线（约 2–3 周）

- MapLibre + OpenFreeMap 底图；
- 经纬度、地图点选、地点搜索；
- 路线 polyline、里程、耗时、来源标记；
- 拖动重排后的局部重算与缓存；
- 每日汇总、地图版权标注、断网降级；
- 性能测试：低端 Android WebView、100 个点、连续拖动。

**验收：** 5 个真实地点能画出沿道路的路线；每天总里程与地图一致；断网能看到缓存/估算提示；拖动能触发重算而不阻塞 UI。

### Phase 3 · Android 壳与首个 APK（约 3–5 天）

- Capacitor 接入，生成 `android/`；
- 全屏/安全区、状态栏、返回键；
- 应用名、图标、包名、竖屏锁定；
- debug APK 在真机安装；
- 地图 key/网络/权限检查。

**验收：** APK 可安装；返回键从 Day 回总览；拖动中返回会先取消拖动；没有浏览器地址栏/系统状态栏冲突；断网可编辑。

### Phase 4 · 局域网协作 MVP（约 2–4 周）

- Kotlin 插件：NSD 注册/发现、本地 WS 服务、前台服务、token；
- 房主/加入 UI、附近行程列表、二维码、手动 IP；
- 快照 + 修订号 + 操作广播；
- 离线队列与重连；
- presence（谁在看哪一天）；
- 两台真机、三台真机、热点、公共 Wi-Fi 的测试矩阵。

**验收：** 两台手机同一 Wi-Fi，10 秒内发现并可加入；修改 1 秒内出现在另一台；离线修改重连后可合并；房主离开有明确提示且不丢本地数据。

### Phase 5 · 离线地图包与硬化（约 2–4 周，可选但建议）

- 按行程下载 PMTiles 区域包；
- 本地 glyphs/sprites，离线中文标签；
- 路线缓存与“离线估算”状态；
- 地图包下载管理、存储清理、校验；
- 是否引入设备内路由（BRouter 等）单独评估。

**验收：** 开飞行模式仍能看地图、看已缓存路线、编辑并同步（在同一局域网内）；存储占用可解释。

### Phase 6 · 发布准备

- release keystore（在仓库外/CI secret）；
- versionCode/versionName；
- APK/AAB、签名、安装包体积；
- 隐私说明（局域网权限、地图请求、数据只在本机）；
- 崩溃与日志策略；
- 备份/导出/导入；
- 用户测试。

### 最小可用版本（MVP）边界

建议把 MVP 定义为：

- 1 趟旅行、最多 7 天、每天最多 10 个点、2–6 人；
- 真实地图 + 真实坐标 + 路线/距离（在线或缓存）；
- 本地持久化 + 拖拽重排 + 预订；
- 同一 Wi-Fi、App 打开时实时同步；
- 可安装的 debug APK；
- 不做账号、推送、云端、照片同步、公交实时、全离线地图包。

这个范围大约需要 6–10 周（一人、熟悉 TS/Android 的前提下；地图与原生发现各留出 spike 时间）。如果一开始就要求“全离线地图 + 离线重算 + 后台实时同步”，周期会明显更长。

---

## 7. 风险与待确认

### 7.1 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 把“无服务器”误解成“无网络” | 地图/算路方案完全不同 | 先确认地图是否允许联网；分层设计 |
| 公共地图服务条款变化 | 地图突然不可用 | 抽象 tile source；可切自托管/PMTiles |
| OSM 官方瓦片被用于离线 | 被封禁/违反政策 | 永不做 prefetch；走 OpenFreeMap/PMTiles |
| 路由质量不足 | 距离/时间不可信 | 明确 source；先步行/驾车；公交后置 |
| 局域网组播被禁 | 发现失败 | 二维码/手动 IP 兜底；测试矩阵 |
| Android 后台限制 | 房主掉线 | 前台服务；UI 明示；房主迁移后续 |
| 并发拖动冲突 | 顺序不确定/数据错乱 | 房主串行、稳定 ID、rev、冲突提示 |
| 没有云端备份 | 手机丢失即丢失 | 本地导出/导入；定期备份提醒 |
| WebView 地图性能 | 拖动卡顿 | 早做性能 spike；必要时 Leaflet/原生地图 |
| 明文局域网传输 | 隐私泄露 | token + 应用层加密；不信任公共 Wi-Fi |
| 范围膨胀 | 交付延期 | 严格 MVP 边界；离线地图/公交后置 |

### 7.2 需要你确认的决策

1. **地图与算路可以联网吗？**  
   推荐：可以联网，但行程与协作不依赖云；断网可看缓存/估算。  
   如果必须完全离线，Phase 2/5 的方案和工期都要改。
2. **只做 Android 吗？**  
   APK 的话默认 Android 优先；Capacitor 的 Web 层可复用，但 iOS 的局域网/前台服务要另做。
3. **群组规模与使用频率？**  
   2–6 人、旅行期间每天同步，和 20 人长期协作，是两种协议。
4. **公交/地铁是否是第一版硬需求？**  
   推荐第一版只做步行 + 打车/驾车；公交需要 GTFS/OTP，工作量大。
5. **是否需要照片/票据同步？**  
   推荐 v1 只同步结构化行程；照片走本地，后续再做局域网传输。
6. **是否可以接受“房主手机必须开着 App”这个限制？**  
   如果不可接受，需要把更多逻辑下沉到原生后台服务，成本更高。
7. **应用名/包名**  
   暂定「沿路」/ `com.yanlu.travel`，可以后续改，但越早定越好。

---

## 8. Git 与版本控制

本次已建立仓库基线。约定如下：

- 主分支：`main`；
- 功能分支：`feat/map-engine`、`feat/lan-sync`、`feat/android-shell`；
- 提交信息用前缀：`feat:`, `fix:`, `docs:`, `chore:`, `test:`；
- 原型打标签 `v0.1-prototype`；
- 大文件不进 Git：`*.apk`、`*.aab`、`*.jks`、`*.keystore`、`*.pmtiles`、`*.mbtiles`、`*.osm.pbf`；
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

## 9. 建议的下一步

**先做决策，再做两个技术 spike，最后才改 UI。**

1. 确认第 7.2 节中的前 4 个决策（尤其地图是否允许联网）。
2. Spike A：用 MapLibre + OpenFreeMap 在现有 App 里画一条真实的京都路线，验证 WebView 性能与版权标注。
3. Spike B：两台 Android 真机，用原生 NSD + 本地 WebSocket 做“发现 → 加入 → 一条消息广播”，验证局域网可行性。
4. Spike 通过后再进入 Phase 1：搭 Vite/React 工程、数据模型、本地存储、编辑闭环。
5. 尽早做一个只读的 APK 壳，把真机安装、返回键、安全区问题提前暴露。

---

### 参考链接

- [OpenFreeMap](https://openfreemap.org/)
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Protomaps Basemaps for MapLibre](https://docs.protomaps.com/basemaps/maplibre)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Capacitor](https://capacitorjs.com/docs)
- [OSRM](https://project-osrm.org/)
- [Valhalla](https://valhalla.github.io/valhalla/)
- [Android NsdManager](https://developer.android.com/reference/android/net/nsd/NsdManager)
