#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/packs
for city in chongqing wuhan guiyang; do
  rm -rf "public/packs/$city"
  mkdir -p "public/packs/$city/tiles"
  TILE_SRC="../android/app/src/main/assets/web/tiles/$city"
  if [ ! -d "$TILE_SRC" ]; then TILE_SRC="dist/packs/$city/tiles"; fi
  cp -R "$TILE_SRC/." "public/packs/$city/tiles/"
  cp "../spikes/data/$city-walk.json" "public/packs/$city/walk.json"
  cp "../spikes/data/$city-car.json" "public/packs/$city/car.json"
  python3 - "$city" <<'PY'
import json, os, sys
city=sys.argv[1]
base=os.path.join('public','packs',city)
walk=os.path.getsize(os.path.join(base,'walk.json'))
car=os.path.getsize(os.path.join(base,'car.json'))
tiles=sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(os.path.join(base,'tiles')) for f in fs)
manifest={'id':city,'version':'2026.10.22','walk':'walk.json','car':'car.json','tiles':'tiles/','walkBytes':walk,'carBytes':car,'tilesBytes':tiles,'sizeBytes':walk+car+tiles}
json.dump(manifest,open(os.path.join(base,'manifest.json'),'w'),ensure_ascii=False,indent=2)
print(city, 'walk', walk, 'car', car, 'tiles', tiles, 'total', walk+car+tiles)
PY
done
