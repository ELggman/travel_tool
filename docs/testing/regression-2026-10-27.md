# 当前构建回归记录（2026-10-27）

- 版本：`v3.8-route-labels` / 提交 `33292e5`
- APK：`android/build/yanlu-spike-debug.apk`，661 KB
- 环境：Web（Vite + Headless Chrome）+ 两台 Android 模拟器（Android 35 arm64）
- 结论：**Web 冒烟和双模拟器互连通过；真机/真实热点仍未测**

## 1. Web 冒烟

| 项 | 结果 | 证据 |
|---|---|---|
| 首屏启动 | 通过 | 三页 tab：行程 / 当天 / 同行 |
| 当天页 | 通过 | 4 个 Stop，时间轴与路线存在 |
| 路线标签 | 通过 | `步行 938 m · 13 分钟`、`打车 · 估算 3.6 km · 7 分钟` |
| 估算说明 | 通过 | 当天说明包含“打车时间不含实时路况；算路失败显示粗略估算” |
| 同行页文案 | 通过 | 显示“同一局域网（Wi-Fi 或房主手机热点）” |
| 控制台错误 | 通过 | 无记录错误 |

## 2. 双 Android 模拟器互连

- Host：emulator-5554，昵称 `HostTest`
- Guest：emulator-5556，昵称 `GuestTest`
- Guest 通过 `10.0.2.2:8766` + adb forward 加入
- 房间 token：26 位
- 结果：

```text
在线 2 人
HostTest · GuestTest
HostTest：DAY 01 … · GuestTest：DAY 01 …
```

- Guest 改当天标题为“回归标题”
- Host 总览自动更新为“回归标题”
- 版本从 v1 递增
- 未出现手动刷新需求

## 3. 地图包 SHA-256

```text
expected a4acc4a6...749c1
actual   a4acc4a6...749c1
match true
```

校验 sidecar 与 zip 一致；本轮未重新下载 41 MB 做端到端 UI 验证。

## 4. 未覆盖

- 两台 Android 真机
- 真实 Wi-Fi / 房主热点 / AP 隔离
- 真实蜂窝弱网
- 完整地图包下载与飞行模式
- iOS
- 操作日志 / delta
- CDN / Range / 断点续传

## 5. 备注

本轮回归使用 adb forward，不是真实无线链路；双真机验收请使用 [双真机测试用例](real-device-test-cases.md)。
