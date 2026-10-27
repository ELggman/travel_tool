# M3.3c · 局域网房间 token 与请求头隔离

- 日期：2026-10-27
- 目的：安全最小集第一步，移除 6 位房间码与 URL 中的 token

## 变更

| 项 | 之前 | 现在 |
|---|---|---|
| 房间凭证 | 6 位数字（约 10⁶） | 26 位随机 base32（约 130 bit） |
| 传输位置 | `?room=` URL query | `X-Yanlu-Room` 请求头 |
| query 兼容 | 支持 | **拒绝**；`/info?room=` 返回 403 |
| CORS | 允许 `Content-Type` | 增加 `X-Yanlu-Room`，预检返回 200 |

服务端生成字符集：`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉易混淆字符），长度 26。

## 验证

```text
GET /info?room=<26位token>       -> 403
GET /info (X-Yanlu-Room: token)  -> 200
GET /snapshot (X-Yanlu-Room)     -> 200
OPTIONS /info (预检)             -> 200，Allow-Headers 含 X-Yanlu-Room
```

浏览器 Guest 加入成功：

```text
在线 2 人 / 房主 · 同行者
```

## 请求限速（2026-10-27 补）

- 按客户端 IP 统计房间认证失败
- 60 秒窗口内失败 20 次 → 锁定 30 秒
- 锁定期间即使 token 正确也返回 **429**
- 服务重启/开新房清空计数

验证：连续无凭证请求触发 429；重启 Host 后正确 token 返回 200。

## 仍未做

- HTTPS 或应用层 AES-GCM
- CORS 收窄（仍为 `*`）
- token 在二维码中的展示（当前只有手动输入）

## 结论

凭证强度已从“6 位数字”提升到“约 130 bit”，且 token 不再进入 URL。**传输仍为明文 HTTP，适合可信局域网，不适合公共 Wi-Fi。**
