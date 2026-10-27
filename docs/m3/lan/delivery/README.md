# M3.3a · 写入幂等、并发拒绝与房间历史

- 日期：2026-10-27
- 状态：Android Host API 验证通过；浏览器 Guest 回归通过；两台 Android 真机待验收

## 写入幂等

`POST /snapshot` 新增：

```text
clientId=<device-id>
seq=<per-device递增序号>
```

服务端：

- 记录每个客户端最后成功 seq
- 相同 clientId 且 seq <= 已记录 seq：返回 duplicate，不再写入
- 成功后才推进 seq

验证：

```text
第一次 deviceA seq=1 -> 200 v2
重复 deviceA seq=1   -> 200 duplicate v2
过期 baseVersion    -> 409 v2
```

这解决超时重试造成的重复写入。

## 并发写入

两个客户端同时用同一个 `baseVersion=2` 写：

```text
race1 -> 200 v3
race2 -> 409 version conflict v3
```

服务端只接受一个版本分支，另一个必须拉取/合并后重写。

## 房间历史

```text
GET /history?room=XXXXXX
```

最近 30 次成功写入，包含：

- version
- clientId
- seq
- baseVersion
- bytes
- timestamp

用于本地审计和排查覆盖问题，不作为同步权威。

## 客户端

- Host bridge 新增 `publishAtSeq(json, baseVersion, clientId, seq)`
- Guest POST 自动携带 `baseVersion/clientId/seq`
- 每次写递增本地 seq
- 自动同步失败显示“自动同步失败，等待重试”
- 轮询连续失败显示“连接中断，重试中…”

## 与三向合并的关系

- `baseVersion` 防止过期写入覆盖
- 409 后客户端先拉取，再三向合并
- `clientId+seq` 防止超时重试重复写
- 字段级合并仍由客户端完成

## 仍然不是完整操作日志

当前服务端保存的是**快照版本历史**，不是 Day/Stop 级操作日志：

- 不能逐操作回放
- 不能做字段级服务端合并
- 没有 tombstone 表
- 删除与修改冲突仍由客户端三向合并判断
- 两台 Android 真机同 Wi-Fi 未实测

## 下一步

M3.3b：真正操作日志/增量补发，或先完成两台 Android 真机验收。
