# 地图包 SHA-256 校验

- 日期：2026-10-27
- 目的：下载的 `.yanlu-pack.zip` 在解压/写 CacheStorage 前验证完整性

## 生成

`app/scripts/build_pack_archives.py` 在打包后写入：

```text
app/pack-server/packs/<archive>.yanlu-pack.zip.sha256
```

格式：

```text
<64位hex>  <archive>.yanlu-pack.zip
```

当前 sidecar 已为重庆/武汉/贵阳/重庆精细包生成。

## 客户端

`downloadPackArchive`：

1. 下载 zip
2. 拉取同路径 `.sha256` sidecar
3. 用 WebCrypto `SHA-256` 计算下载内容
4. 不匹配 → 抛出“文件可能损坏或被篡改”，不写入缓存
5. 匹配 → 解压、写 CacheStorage

缺少 sidecar 或格式错误也会拒绝。

## 验证

```text
expected a4acc4a6...749c1
actual   a4acc4a6...749c1
match true
```

## 限制

- sidecar 本身仍通过 HTTP 获取；能篡改 zip 的攻击者也可能篡改 sidecar
- 没有签名，只防传输损坏/误替换
- pack server 仍需支持 Range/断点续传（未做）
- 没有在真机完整重新下载 41 MB 包做端到端验证
- 已有缓存包不会重新校验

## 下一步

- CDN/OSS 接入
- 断点续传/暂停
- 包版本更新
- 真机完整下载验收
