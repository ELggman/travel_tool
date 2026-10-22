#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="$ROOT/.toolchain"
SDK="$TOOL/android-sdk"
JAVA_HOME="$TOOL/jdk/Contents/Home"
BUILD="$ROOT/android/build"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
export HOME="$TOOL/android-user"
export ANDROID_USER_HOME="$TOOL/android-user"

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

"$SDK/build-tools/35.0.0/aapt2" link \
  -o "$BUILD/app-unsigned.apk" \
  -I "$SDK/platforms/android-35/android.jar" \
  --manifest "$ROOT/android/app/src/main/AndroidManifest.xml" \
  -A "$ROOT/android/app/src/main/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 26 --target-sdk-version 35 \
  --version-code 1 --version-name 0.1-spike

find "$ROOT/android/app/src/main/java" -name '*.java' > "$BUILD/sources.txt"
"$JAVA_HOME/bin/javac" -source 17 -target 17 \
  -classpath "$SDK/platforms/android-35/android.jar" \
  -d "$BUILD/classes" @"$BUILD/sources.txt"

find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$SDK/build-tools/35.0.0/d8" --lib "$SDK/platforms/android-35/android.jar" \
  --min-api 26 --output "$BUILD/dex" @"$BUILD/classes.txt"

( cd "$BUILD" && zip -q -uj app-unsigned.apk dex/classes.dex )
"$SDK/build-tools/35.0.0/zipalign" -f 4 "$BUILD/app-unsigned.apk" "$BUILD/app-aligned.apk"

KEYSTORE="$TOOL/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -v -keystore "$KEYSTORE" \
    -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$SDK/build-tools/35.0.0/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "$BUILD/yanlu-spike-debug.apk" "$BUILD/app-aligned.apk"
"$SDK/build-tools/35.0.0/apksigner" verify --verbose "$BUILD/yanlu-spike-debug.apk" | head -12
ls -lh "$BUILD/yanlu-spike-debug.apk"
