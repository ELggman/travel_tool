#!/usr/bin/env python3
"""Build the WebView asset tree: static ZXY tiles + preview + route graphs.

Requires `tools/pmtiles serve spikes/map --port=8090 --cors='*'` to be running.
"""
import json, math, os, shutil, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "android", "app", "src", "main", "assets", "web")
TILES = os.path.join(ASSETS, "tiles")
BASE = "http://127.0.0.1:8090"
CITIES = json.load(open(os.path.join(ROOT, "spikes", "cities.json")))


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat = max(min(lat, 85.05112878), -85.05112878)
    y = int((1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def main():
    if os.path.isdir(ASSETS):
        shutil.rmtree(ASSETS)
    os.makedirs(os.path.join(ASSETS, "data", "graphs"), exist_ok=True)

    # static web app
    shutil.copy2(os.path.join(ROOT, "spikes", "web", "preview.html"), ASSETS)
    shutil.copytree(os.path.join(ROOT, "spikes", "web", "vendor"), os.path.join(ASSETS, "vendor"))
    for name in ["chongqing.json", "wuhan.json", "guiyang.json", "packs.json"]:
        shutil.copy2(os.path.join(ROOT, "spikes", "web", "data", name), os.path.join(ASSETS, "data", name))
    for city in CITIES:
        for mode in ["walk", "car"]:
            src = os.path.join(ROOT, "spikes", "data", f"{city}-{mode}.json")
            shutil.copy2(src, os.path.join(ASSETS, "data", "graphs", f"{city}-{mode}.json"))

    # ZXY tiles from the local PMTiles server
    for city, cfg in CITIES.items():
        w, s, e, n = cfg["bbox"]
        pack = cfg["pack"].replace(".pmtiles", "")
        count = 0
        total = 0
        for z in range(0, 16):
            x0, y0 = tile_xy(w, n, z)
            x1, y1 = tile_xy(e, s, z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    url = f"{BASE}/{pack}/{z}/{x}/{y}.mvt"
                    try:
                        with urllib.request.urlopen(url, timeout=10) as resp:
                            data = resp.read()
                    except urllib.error.HTTPError:
                        continue
                    if not data:
                        continue
                    path = os.path.join(TILES, city, str(z), str(x), f"{y}.mvt")
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(data)
                    count += 1
                    total += len(data)
        print(f"{city}: {count} tiles, {total / 1e6:.1f} MB (gzip MVT)")
    print("assets:", ASSETS)


if __name__ == "__main__":
    main()
