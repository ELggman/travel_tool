# M3.3b（部分）· 删除 tombstone

- 日期：2026-10-27
- 目的：删除后的 Stop/Day 不因旧客户端/旧快照回传而复活

## 模型

`Trip.tombstones?: Record<string, number>`

key：

```text
stop:<stopId>
day:<dayId>
```

值为删除时间（毫秒）。随 Trip 一起同步、导出、导入。

## 行为

- 删除 Stop：从当天移除，并写入 `stop:<id>`
- 删除 Day：移除当天，并写入 `day:<id>`，同时写入该天所有 Stop 的 `stop:<id>`
- `normalizeTrip` 加载/合并后统一过滤：
  - 丢弃墓碑命中的 Day
  - 丢弃墓碑命中的 Stop
- 如果过滤后没有 Day，回退到种子行程
- 三向合并会把 `tombstones` 当普通对象合并；同 key 不同时间可能产生冲突

## 验证

导入一份数据：

- 含第 1 个 Stop
- 同时含 `stop:<第1个Stop>` 墓碑

结果：

```text
导入前 stops=3
导入后 stops=2
该 Stop 不存在
tombstones 中该 key 保留
```

## 限制

- 不是操作日志；没有 `rev`/`delta`/操作回放
- 墓碑永不清理（会随 Trip 增长；当前最多天/点数很小）
- 冲突选择“保留本机”时，可能重新引入被远端删除的项（用户显式选择）
- 没有为 Booking/Lodging 建墓碑
- 使用导入恢复已删项时，导入文件若不含墓碑即可恢复（显式操作）
- 旧客户端不带墓碑时，仍可能覆盖删除；服务端无法阻止（baseVersion 只能防版本过期）

## 下一步

完整操作日志（clientId+seq+baseVersion+op）仍未实现；tombstone 只解决删除复活的一部分。
