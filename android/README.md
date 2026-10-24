# 沿路 Android 壳（M1）

单 Activity + 本地 HTTP + WebView，用来承载 `app/` 的 M1 版本。

当前 APK 是 **M2.1 真实城市包下载 + 单日行程编辑**。基座不内置地图包，APK 约 637 KB（含本地 glyphs；POI 索引随城市包）；城市包从 pack server 下载到 CacheStorage。

- 本地 HTTP 服务（Java，无第三方依赖），服务 `assets/web` 下的 Vite 构建产物和城市包
- MapLibre + 本地 ZXY 瓦片 + 本地步行/打车图 + Web Worker A*
- 真实归档下载/删除/首启、标准/精细底图、CacheStorage 离线读取、按城市换主题、中文道路/POI 标注、加地点、拖动排序、路线/时间重算、localStorage 持久化
- 飞行模式可加载与算路

## 工具链

`.toolchain/` 已被 Git 忽略：

- Temurin JDK 21
- Android SDK platform-tools、platforms;android-35、build-tools;35.0.0
- 手工 `aapt2 → javac → d8 → zipalign → apksigner`（本机 Gradle native 兼容问题，未用 Gradle 构建）

## 构建 APK

```bash
cd app
npm install
npm run build

cd ..
./android/prepare_app_assets.sh   # 构建 app 并复制 dist 到 assets/web（不含地图包）
./android/build.sh

# 另开终端：启动真实城市包服务器
cd app && python3 scripts/pack_server.py --port 8090
```

输出：

```text
android/build/yanlu-spike-debug.apk   # 约 637 KB
```

`prepare_app_assets.sh` 只把 `app/dist` 复制到 `android/app/src/main/assets/web`；城市包不在 APK 里，运行时从 pack server 下载。assets 与 APK 都不提交 Git。

本地服务细节：

- 端口 `127.0.0.1:8765`
- `/` → `/index.html`
- `.mvt` 以 `Content-Encoding: gzip` 返回
- `.mjs` 返回 `application/javascript`，供 MapLibre worker 使用

## 安装

```bash
export HOME="$PWD/.toolchain/android-user"
export ANDROID_USER_HOME="$PWD/.toolchain/android-user"
.toolchain/android-sdk/platform-tools/adb devices -l
.toolchain/android-sdk/platform-tools/adb install -r android/build/yanlu-spike-debug.apk
.toolchain/android-sdk/platform-tools/adb shell am start -n com.yanlu.travel/.MainActivity
```

物理真机需要打开开发者选项 → USB 调试；无线调试要求手机和 Mac 在同一 WLAN（手机开热点时通常不能同时作为 STA，因此无线调试不可用）。

真机下载地图包时，**不要用模拟器的 `10.0.2.2`**。在 App 地图包底部“包服务器”填 Mac 当前局域网 IP（用 `ipconfig getifaddr en0` 查），例如 `http://192.168.10.234:8090`；IP 会变化，不要照抄示例。不需要科学上网。详细排查见 [docs/m2/troubleshooting](../docs/m2/troubleshooting/README.md)。

## 验证记录

M2.1 已在 Android 35 arm64 模拟器 `sdk_gphone64_arm64` 验证：

- 基座 APK 约 637 KB，首启进入“先下载一座城市”
- 通过 `10.0.2.2:8090` 下载重庆归档，缓存 484 个条目，地图/路线 6.9 km
- 中文道路/POI 标注在飞行模式下正常
- 重庆核心区精细层 z16 下载后，缓存约 1289 条（1288 个 z16 瓦片），主城全区底图保持；地图包内“查看精细层”飞到 z16，地图/路线正常
- 重庆标准包已扩到主城全区（39 MB zip / 78.5 MB 解压），缓存 6407 个瓦片，地图/路线正常
- 停掉 pack server 后强停重开，地图和路线仍可用
- 下载武汉并切换湖北主题，删除武汉后缓存只剩重庆
- 飞行模式 + 关闭 Wi-Fi/数据，强停重开，地图、中文标注和 6.9 km 路线仍可用

M1 记录（旧）：

- 旧 M1 冷启动 `TotalTime: 655 ms`；M2.1 未单独复测冷启动
- 旧 M1 PSS 93.5 MB（M2.1 未复测）
- 地图、路线、加地点、改停留、拖动排序、路线重算正常
- 地图包下载/切换正常：重庆 41.2 MB，武汉 11.6 MB（含 POI 索引）
- 飞行模式 + 关闭 Wi-Fi/数据，强停重开仍加载武汉地图和路线

截图：

- [Android 首页](../docs/m1/screenshots/android-home.png)
- [Android 武汉](../docs/m1/screenshots/android-wuhan.png)
- [Android 离线](../docs/m1/screenshots/android-offline.png)

## 限制

- 当前下载的是 `.yanlu-pack.zip`（静态 ZXY + graph），不是单文件 PMTiles + Range；生产包格式可继续演进。
- 本地服务只支持 GET/HEAD，不支持 Range；当前静态资源不需要。
- M2.1 只有单日和精选地点，没有离线 POI 搜索、多日、多人同步。
- 物理真机尚未验证 M2.1 下载/缓存；模拟器结果只作参考。
- Android 默认 pack server 是 `10.0.2.2:8090`，只适配模拟器；物理机需要局域网 IP/CDN。
- 旧的“三城验证页”脚本 `prepare_assets.py` 保留作历史；M2.1 用 `prepare_app_assets.sh`。
