#!/usr/bin/env python3
"""Extract highway topology + named POIs for a city bbox from an OSM PBF.

Run inside .venv-spike (requires pyosmium).
Output: spikes/data/<city>-osm.json
"""
import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter

import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "spikes", "data")

HIGHWAYS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "pedestrian", "footway", "steps",
    "path", "cycleway", "track", "road", "corridor", "elevator", "platform",
}
KEEP_TAGS = {
    "highway", "name", "ref", "oneway", "junction", "access", "foot", "motor_vehicle",
    "motorcar", "vehicle", "bicycle", "service", "bridge", "tunnel", "layer",
    "surface", "smoothness", "tracktype", "maxspeed", "lanes", "width", "incline",
    "steps", "indoor", "level", "sidewalk", "footway", "crossing", "area",
    "est_width", "covered", "highway:name", "ramp", "conveying",
}
POI_TAGS = {
    "tourism", "amenity", "shop", "leisure", "historic", "place", "railway",
    "public_transport", "office", "craft", "emergency", "healthcare", "education",
}
TARGET_NAMES = re.compile(
    r"解放碑|洪崖洞|十八梯|李子坝|磁器口|观音桥|朝天门|南滨路|来福士|长江索道|"
    r"黄鹤楼|户部巷|江汉路|武汉关|武汉大学|东湖|楚河汉街|光谷|武昌站|汉口站|"
    r"甲秀楼|黔灵山|喷水池|花果园|观山湖|青岩|贵阳北站|贵阳站|文昌阁"
)


def in_bbox(lon, lat, bbox):
    w, s, e, n = bbox
    return w <= lon <= e and s <= lat <= n


def centroid(coords):
    if not coords:
        return None
    return [sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords)]


class ExtractHandler(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.nodes = {}
        self.ways = []
        self.landmarks = []
        self.poi_count = 0
        self.stats = Counter()

    def node(self, n):
        lon, lat = n.location.lon, n.location.lat
        if not in_bbox(lon, lat, self.bbox):
            return
        tags = n.tags
        name = tags.get("name")
        is_poi = any(k in tags for k in POI_TAGS)
        if is_poi:
            self.poi_count += 1
        if name and (is_poi or TARGET_NAMES.search(name)):
            kind = next((k for k in POI_TAGS if k in tags), "")
            self.landmarks.append({
                "name": name,
                "name_en": tags.get("name:en", ""),
                "kind": kind,
                "kind_value": tags.get(kind, "") if kind else "",
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "osm_type": "node",
                "osm_id": n.id,
            })

    def way(self, w):
        coords = []
        refs = []
        for nd in w.nodes:
            try:
                loc = nd.location
            except Exception:
                continue
            if not loc.valid():
                continue
            lon, lat = loc.lon, loc.lat
            refs.append(nd.ref)
            coords.append((lon, lat))
            # keep all referenced nodes; ways outside bbox may be filtered below
        if not refs:
            return
        if not any(in_bbox(lon, lat, self.bbox) for lon, lat in coords):
            return

        tags = {k: w.tags[k] for k in KEEP_TAGS if k in w.tags}
        hw = tags.get("highway")
        name = w.tags.get("name")
        if hw in HIGHWAYS:
            for nid, (lon, lat) in zip(refs, coords):
                self.nodes[str(nid)] = [round(lon, 6), round(lat, 6)]
            self.ways.append({
                "id": w.id,
                "tags": tags,
                "nodes": refs,
            })
            self.stats["highway_ways"] += 1

        is_poi = any(k in w.tags for k in POI_TAGS)
        if is_poi:
            self.poi_count += 1
        if name and (is_poi or TARGET_NAMES.search(name)):
            c = centroid(coords)
            if c and in_bbox(c[0], c[1], self.bbox):
                kind = next((k for k in POI_TAGS if k in w.tags), "")
                self.landmarks.append({
                    "name": name,
                    "name_en": w.tags.get("name:en", ""),
                    "kind": kind,
                    "kind_value": w.tags.get(kind, "") if kind else "",
                    "lon": round(c[0], 6),
                    "lat": round(c[1], 6),
                    "osm_type": "way",
                    "osm_id": w.id,
                })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city", choices=["chongqing", "chongqing-wide", "wuhan", "guiyang"])
    args = ap.parse_args()

    cities = json.load(open(os.path.join(ROOT, "spikes", "cities.json")))
    cfg = cities[args.city]
    pbf = os.path.join(DATA, "osm", cfg["pbf"])
    if not os.path.exists(pbf):
        sys.exit(f"PBF not found: {pbf}")

    started = time.time()
    handler = ExtractHandler(cfg["bbox"])
    print(f"[{args.city}] reading {pbf} bbox={cfg['bbox']} ...", flush=True)
    # flex_mem is fine for province extracts up to ~60MB PBF on a 16GB machine.
    handler.apply_file(pbf, locations=True, idx="flex_mem")
    print(f"[{args.city}] parsed in {time.time()-started:.1f}s; "
          f"ways={len(handler.ways)} nodes={len(handler.nodes)} "
          f"landmarks={len(handler.landmarks)} poicount={handler.poi_count}", flush=True)

    # De-duplicate landmark names, preferring entries with a useful kind and earlier order.
    seen = set()
    landmarks = []
    for lm in handler.landmarks:
        key = (lm["name"], round(lm["lon"], 4), round(lm["lat"], 4))
        if key in seen:
            continue
        seen.add(key)
        landmarks.append(lm)

    out = {
        "city": args.city,
        "name": cfg["name"],
        "bbox": cfg["bbox"],
        "source": "Geofabrik China province extract, " + cfg["pbf"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "stats": {
            "highway_ways": len(handler.ways),
            "graph_nodes": len(handler.nodes),
            "named_pois": handler.poi_count,
            "landmarks": len(landmarks),
        },
        "nodes": handler.nodes,
        "ways": handler.ways,
        "landmarks": landmarks,
    }
    outpath = os.path.join(DATA, f"{args.city}-osm.json")
    with open(outpath, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[{args.city}] wrote {outpath} " f"{os.path.getsize(outpath)/1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
