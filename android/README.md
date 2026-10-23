# 沿路 Android 壳（M1）

单 Activity + 本地 HTTP + WebView，用来承载 `app/` 的 M1 版本。

当前 APK 已经不是三城验证页，而是 **省份/城市地图包 + 单日行程编辑** 的第一版：

- 本地 HTTP 服务（Java，无第三方依赖），服务 `assets/web` 下的 Vite 构建产物和城市包
- MapLibre + 本地 ZXY 瓦片 + 本地步行/打车图 + Web Worker A*
- 城市包下载/切换、按城市换主题、加地点、拖动排序、路线/时间重算、localStorage 持久化
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
./android/prepare_app_assets.sh   # 构建 app 并复制 dist + packs 到 assets/web
./android/build.sh
```

输出：

```text
android/build/yanlu-spike-debug.apk   # 约 26 MB
```

`prepare_app_assets.sh` 会把 `app/dist` 全部复制到 `android/app/src/main/assets/web`；城市包在 `app/public/packs`，构建时一起进 APK。assets 与 APK 都不提交 Git。

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

## 验证记录

已在 Android 35 arm64 模拟器 `sdk_gphone64_arm64` 验证：

- 冷启动 `TotalTime: 655 ms`；本地服务起来后约 0.5 s 页面完成
- PSS 93.5 MB / RSS 214.6 MB（模拟器参考值）
- 地图、路线、加地点、改停留、拖动排序、路线重算正常
- 地图包下载/切换正常：重庆 17.6 MB，武汉 21.2 MB
- 飞行模式 + 关闭 Wi-Fi/数据，强停重开仍加载武汉地图和路线

截图：

- [Android 首页](../docs/m1/screenshots/android-home.png)
- [Android 武汉](../docs/m1/screenshots/android-wuhan.png)
- [Android 离线](../docs/m1/screenshots/android-offline.png)

## 限制

- 当前是静态 ZXY 瓦片树 + 路网图，不是单文件 PMTiles + Range；生产包管理在 M2 做。
- 本地服务只支持 GET/HEAD，不支持 Range；当前静态资源不需要。
- M1 只有单日和精选地点，没有离线 POI 搜索、多日、多人同步。
- 物理真机的 M1 安装/性能还未由本机验证；模拟器结果只作参考。
- 旧的“三城验证页”脚本 `prepare_assets.py` 保留作历史，不再用于当前 APK；M1 用 `prepare_app_assets.sh`。
