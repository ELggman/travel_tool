#!/usr/bin/env python3
"""Build compact, search-oriented POI indexes from an OSM PBF.

Unlike extract_city.py (routing/graph), this keeps every named place, shop,
office, amenity and named building polygon. Run with .venv-spike.
"""
import argparse, json, math, os, sys
from collections import Counter
import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CITIES = os.path.join(ROOT, "spikes", "cities.json")
DATA = os.path.join(ROOT, "spikes", "data", "osm")
OUT = os.path.join(ROOT, "app", "public", "poi")

# Priority order is deliberate: a supermarket inside a mall should be shop=supermarket,
# not building=yes.
TAGS = [
    "tourism", "historic", "amenity", "shop", "leisure", "office", "craft",
    "emergency", "healthcare", "education", "building", "man_made", "landuse",
    "natural", "place", "public_transport", "railway",
]
EXCLUDE = {"highway", "waterway", "barrier", "route", "boundary", "power", "aeroway"}
NAME_KEYS = ("name", "name:zh", "name:zh-Hans", "name:zh-Hant", "name:en")


def in_bbox(lon, lat, bbox):
    w, s, e, n = bbox
    return w <= lon <= e and s <= lat <= n


def centroid(coords):
    if not coords:
        return None
    return sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords)


def pick_kind(tags):
    for k in TAGS:
        if k in tags:
            return k, tags.get(k, "")
    return "", ""


class Handler(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.items = []
        self.stats = Counter()

    def add(self, name, tags, lon, lat, osm_type, osm_id):
        if not name or not in_bbox(lon, lat, self.bbox):
            return
        if any(k in tags for k in EXCLUDE):
            # named roads/waterways are not "places" for this index
            if not any(k in tags for k in ("tourism", "amenity", "shop", "office", "building")):
                return
        kind, kind_value = pick_kind(tags)
        if not kind:
            return
        self.items.append({
            "name": name,
            "kind": kind,
            "kindValue": kind_value,
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "nameEn": tags.get("name:en", ""),
        })
        self.stats[kind] += 1

    def node(self, n):
        tags = n.tags
        name = next((tags.get(k) for k in NAME_KEYS if tags.get(k)), "")
        if not name:
            return
        self.add(name, tags, n.location.lon, n.location.lat, "node", n.id)

    def way(self, w):
        tags = w.tags
        name = next((tags.get(k) for k in NAME_KEYS if tags.get(k)), "")
        if not name:
            return
        coords = []
        for nd in w.nodes:
            try:
                loc = nd.location
            except Exception:
                continue
            if loc.valid():
                coords.append((loc.lon, loc.lat))
        c = centroid(coords)
        if c:
            self.add(name, tags, c[0], c[1], "way", w.id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city", choices=["chongqing-wide", "wuhan", "guiyang"])
    args = ap.parse_args()
    cities = json.load(open(CITIES))
    cfg = cities[args.city]
    pbf = os.path.join(DATA, cfg["pbf"])
    handler = Handler(cfg["bbox"])
    handler.apply_file(pbf, locations=True, idx="flex_mem")
    seen = set()
    out = []
    for x in handler.items:
        key = (x["name"], round(x["lon"], 5), round(x["lat"], 5))
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    out.sort(key=lambda x: x["name"])
    os.makedirs(OUT, exist_ok=True)
    target = "chongqing" if args.city == "chongqing-wide" else args.city
    path = os.path.join(OUT, f"{target}.json")
    with open(path, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{target}: {len(out)} items, {os.path.getsize(path)/1e6:.1f} MB")
    print(handler.stats.most_common(15))


if __name__ == "__main__":
    main()
