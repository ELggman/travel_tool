# 双 Android 模拟器 App-to-App 验收（真机延后的替代）

- 日期：2026-10-27
- 目的：无法使用 Android 真机时，用两台 Android 模拟器验证“Android App ↔ Android App”的完整局域网链路
- 结论：**通过（但不等同真机 Wi-Fi 验收）**

## 环境

| 项 | Host | Guest |
|---|---|---|
| AVD | `yanlu35` | `yanlu35b`（新建） |
| 端口 | emulator-5554 | emulator-5556 |
| 镜像 | Android 35 google_apis arm64-v8a | 同左 |
| App | `yanlu-spike-debug.apk`（657 KB） | 同左 |
| 城市包 | 已下载重庆 | 首次下载重庆 41.2 MB |

链路：

```text
Guest App (emulator-5556)
  └─ http://10.0.2.2:8766
       └─ adb -s emulator-5554 forward tcp:8766
            └─ Host App LanSyncServer (emulator-5554:8766)
```

`10.0.2.2` 是模拟器访问 Mac 宿主的地址；Mac 上的 8766 通过 `adb forward` 转发到 Host 模拟器。**这条链路绕过了真实 Wi-Fi、路由器和 AP 隔离，只验证 App 逻辑与原生 HTTP 服务。**

## 结果

1. Host 创建房间：`217323`，版本 v1
2. Guest 输入 `10.0.2.2` + `217323` 加入成功
3. 双方同行页显示 `在线 2 人 / 房主 · 同行者`
4. Guest 改当天标题为“双模拟器同步” → Host 自动收到
5. Host 改当天标题为“房主反向同步” → Guest 自动更新
6. 服务端版本递增，最终 v3

![Host 房间](../screenshots/host-room.png)

![Guest 房间](../screenshots/guest-room.png)

## 这次验证覆盖了什么

- Android WebView + 原生 `ServerSocket` 的真实运行
- Guest 使用 App 内 HTTP 客户端（不是浏览器）访问 Host
- 房间码、`/info` 房间保护、`/snapshot` 版本、自动同步、成员心跳
- 双向修改传播
- 两台 App 同时在前台

## 没有覆盖什么

- 真实 Wi-Fi / 路由器 / 热点 / AP 隔离
- NSD 发现（当前无 NSD）
- 锁屏、切后台、前台服务
- 断网 → 重连
- 同字段冲突、三向合并的真实双 App 并发（此前用浏览器 Guest + 直接 POST 验证）
- 5 台以上设备、弱网、丢包、延迟
- 真机厂商 WebView 差异

## 结论

**可以作为“真机不可用”期间的替代验收，但不能替代 Phase 5 的最终真机验收。** 文档中 Phase 5 的真机项保持“延后”，不标记为完成。
