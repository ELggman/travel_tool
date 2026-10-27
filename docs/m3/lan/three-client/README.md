# 三客户端局域网验收

- 日期：2026-10-27
- 目的：在双模拟器之外，验证 3 个成员同时在线、修改广播、成员离开
- 拓扑：

```text
Android Host（emulator-5554，LanSyncServer）
├── Android Guest（emulator-5556）
└── 浏览器 Guest（Chrome，127.0.0.1:8766 + adb forward）
```

## 结果

1. Host 创建房间 `ZQKCT32G73L226HDQTHTFVJRZN`，v1
2. Android Guest 加入，成员 2
3. 浏览器 Guest 加入，成员 3：

```text
在线 3 人
房主 · 同行者 · 同行者
```

4. 浏览器 Guest 修改当天标题为“三端同步”
5. Android Host 与 Android Guest 都自动更新
6. Android Guest 点“离开”
7. Host 与浏览器约数秒后显示：

```text
在线 2 人
房主 · 同行者
```

## 覆盖

- 3 个客户端同时轮询/心跳
- 一次写入广播到另外两端
- 显式 `/leave` 与成员列表更新
- Host / Android Guest / 浏览器 Guest 混合拓扑

## 限制

- 不是 3 台 Android 真机；第三端是浏览器
- 成员昵称已支持（2026-10-27）：可在加入房间前设置；已验证 Host“房主Momo” + 浏览器 Guest“阿宁”显示为 `房主Momo · 阿宁`
- 未测 3 个客户端同时写同一字段
- 未测弱网/丢包
- 仍经 adb forward，不是真实 Wi-Fi

## 结论

3 客户端在线与广播路径可用；成员命名和多客户端并发冲突仍需后续完善。
