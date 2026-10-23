#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd app && npm run build)
rm -rf android/app/src/main/assets/web
mkdir -p android/app/src/main/assets/web
cp -R app/dist/. android/app/src/main/assets/web/
echo "assets: $(du -sh android/app/src/main/assets/web | cut -f1)"
