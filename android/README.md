# 沿路 Android 离线地图 Proof

这是一个**单 Activity WebView 验证壳**，用于在 Android 上验证：

- 本地 HTTP 服务（Kotlin/Java，无第三方依赖）
- 三城离线矢量瓦片（从 PMTiles 导出的 ZXY 树）
- 本地 MapLibre + 本地路网图 + 浏览器内 A*
- 断网/飞行模式下加载与重算

它不是最终 App 架构；正式版应改为 Capacitor/Kotlin 插件 + 原生 PMTiles/包管理，详见 [三城报告](../docs/spikes/city-map-report.md)。

## 已安装的工具链（本机）

工具链在 `.toolchain/`，已被 Git 忽略：

- Temurin JDK 21
- Android SDK：platform-tools、platforms;android-35、build-tools;35.0.0
- Gradle 8.13（本构建实际使用 aapt2/d8/apksigner 手工流水线，绕开本机 Gradle native 兼容问题）

## 准备 assets

先启动 PMTiles 的本地 ZXY 服务：

```bash
tools/pmtiles serve spikes/map --port=8090 --cors='*' &
python3 android/prepare_assets.py
```

`prepare_assets.py` 会生成：

```text
android/app/src/main/assets/web/
├── preview.html
├── vendor/                 # MapLibre
├── data/                   # 路线摘要 + manifest + 路网图
└── tiles/<city>/<z>/<x>/<y>.mvt   # gzip MVT；服务端发送 Content-Encoding
```

三城 assets 约 53 MB，APK 约 26 MB。assets 与 APK 均不提交 Git。

## 构建

```bash
./android/build.sh
```

输出：

```text
android/build/yanlu-spike-debug.apk
```

手工流水线：

1. `aapt2 link` 打包 manifest + assets
2. `javac` 编译 Java
3. `d8` 生成 classes.dex
4. `zipalign`
5. `apksigner` 用本地 debug keystore 签名

## 已验证（模拟器）

- Android 35 arm64 模拟器 `sdk_gphone64_arm64`
- 冷启动 971 ms；本地服务起来后 0.38 s 页面完成
- 三城底图/路线/A* 正常；飞行模式 + 关闭 Wi-Fi/数据后仍可加载和重算
- 2026-10-22：用户已手动安装到物理手机并启动成功；物理机量化指标待补
- 关键地点标签在 Android 上显示（HTML overlay，无在线字体）
- PSS 126.6 MB / RSS 239.0 MB（模拟器参考值）
- 截图：[重庆](../docs/spikes/screenshots/android-chongqing.png)、[重庆·地点标签](../docs/spikes/screenshots/android-labels-chongqing.png)、[武汉·飞行模式](../docs/spikes/screenshots/android-wuhan-offline.png)、[贵阳](../docs/spikes/screenshots/android-guiyang.png)

## 真机安装

手机打开“开发者选项 → USB 调试”，连接 USB，授权调试：

```bash
export HOME="$PWD/.toolchain/android-user"
export ANDROID_USER_HOME="$PWD/.toolchain/android-user"
.toolchain/android-sdk/platform-tools/adb devices -l
.toolchain/android-sdk/platform-tools/adb install -r android/build/yanlu-spike-debug.apk
.toolchain/android-sdk/platform-tools/adb shell am start -n com.yanlu.travel/.MainActivity
```

如果 `adb devices` 为空，先检查 USB 线/授权弹窗；本机当前没有检测到已连接 Android 设备，所以还没完成物理真机验收。

## 真机验收点

1. 首屏显示重庆地图和路线列表，没有 WebView 错误页
2. 点左侧“武汉/贵阳”能切换城市，底图和路线跟着切换
3. 点路线列表，地图 fitBounds、起终点 marker、HUD 正常
4. 点“在浏览器本地重算这条路线”，HUD 出现“浏览器本地 A*：… ms”
5. 打开飞行模式 + 关闭 Wi-Fi，强制停止 App 再打开，仍能加载地图和重算
6. `adb logcat -s YanluServer YanluMain YanluWeb` 中没有 404/瓦片解析错误

## 当前限制

- 使用静态 ZXY 瓦片树，不是单文件 PMTiles；三城 tiles 约 21 MB（gzip），生产应改为 PMTiles + Range。
- 本地服务只支持 GET/HEAD，不支持 Range；当前静态瓦片和图数据不需要。
- 未做 Android 真机 UI 适配（状态栏/刘海/横屏）；先验证功能。
- 未验证 WebView 在低端机上的内存和 WebGL 性能。
- 当前没有连接真机；需用户插入手机后才能完成“真机”验收。
