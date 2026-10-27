# M3.2b · 字段级三向合并与版本写入

- 日期：2026-10-27
- 状态：Web Guest + Android Host 联调通过；两台 Android 真机待验证
- 目标：不再整份 Trip 最后写入者覆盖；按字段合并，只有真正冲突才停下

## 三向合并

每台设备保留：

- `base`：最后一次确认同步的 Trip
- `local`：当前本机 Trip
- `remote`：房间里的新快照

合并规则：

- local == remote：不变
- local == base：采用 remote
- remote == base：保留 local
- 对象：逐字段递归
- Day / Stop 数组：按 `id` 合并
- 数组顺序：只有两边都改顺序且不同才冲突
- 同字段两边都改：产生冲突，保留 local，交给人选择
- 删除 vs 修改：冲突
- 新增 Day / Stop：自动合并

冲突路径示例：

```text
trip.days[day-chongqing-1].stops[jiefangbei-2gf2dp].category
```

## 版本写入（409）

`POST /snapshot` 支持：

```text
baseVersion=<本地最后确认版本>
```

服务端：

- baseVersion == 当前 version：接受，version+1
- baseVersion != 当前 version：返回 409
- 不传 baseVersion：兼容旧客户端，仍为无条件写入

Android Host 通过 `publishAt(json, baseVersion)` 使用同一规则。

这样解决了“本机自动推送比远端合并先到”的覆盖竞态：过期写入会被拒绝，客户端拉取/合并后重推。

## 联调验证

### 非冲突合并

基础 v2，4 个地点：

- Guest 本地改第 1 站类别 → `GuestMerge2`
- 同时推送远端第 2 站类别 → `远程分类2`
- Guest 自动合并 → 服务端 v3
- Host 自动拉取 → v4
- 最终两边同时保留 `GuestMerge2` 和 `远程分类2`

### 同字段冲突

基础 v4：

- Guest 本地把第 1 站改为 `ConflictGuest`
- 远端把同一字段改为 `ConflictRemote`
- Guest 显示冲突卡片：

```text
发现字段冲突 v5
trip.days[...].stops[...].category
采用远端 / 保留本机并推送
```

- 本机没有被静默覆盖
- 点“采用远端”后字段才变为 `ConflictRemote`

## 新增接口/方法

```text
POST /snapshot?room=&baseVersion=
Android bridge: publishAt(tripJson, baseVersion)
```

## 限制

- 仍是整份 Trip 快照传输，不是操作日志
- 合并是客户端三向合并，没有服务端历史
- 同一字段冲突需要人工选择，没有自动字段策略
- 数组顺序冲突只提示，不自动排序
- 两台 Android 真机同 Wi-Fi 未实测
- 没有传输加密；房间码仍是 6 位
