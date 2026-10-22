#!/usr/bin/env python3
"""Build walking and taxi road graphs from extracted OSM JSON.

Outputs:
  spikes/data/<city>-walk.json
  spikes/data/<city>-car.json
  spikes/data/<city>-places.json
"""
import argparse
import json
import math
import os
import sys
import time
from collections import defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "spikes", "data")
EARTH_R = 6371000.0

WALK_ALLOWED = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "pedestrian", "footway", "steps",
    "path", "cycleway", "track", "road", "corridor", "elevator", "platform",
}
CAR_ALLOWED = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "track", "road",
}
CAR_SPEED = {
    "motorway": 70, "motorway_link": 45, "trunk": 55, "trunk_link": 40,
    "primary": 45, "primary_link": 35, "secondary": 35, "secondary_link": 30,
    "tertiary": 30, "tertiary_link": 25, "unclassified": 25, "residential": 20,
    "living_street": 15, "service": 15, "track": 15, "road": 20,
}
WALK_SPEED = {
    "steps": 2.6, "footway": 4.6, "path": 4.0, "pedestrian": 4.8,
    "corridor": 4.0, "elevator": 0.8, "platform": 4.6, "track": 4.0,
    "primary": 4.6, "secondary": 4.6, "tertiary": 4.6, "residential": 4.8,
    "service": 4.6, "unclassified": 4.6, "living_street": 4.6,
}

def hav(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))

def tag_is(tags, key, values):
    return tags.get(key) in values

def access_allowed(tags, mode):
    access = tags.get("access", "")
    if access in ("no", "private") and tags.get("foot" if mode == "walk" else "motor_vehicle") not in ("yes", "designated", "permissive"):
        return False
    if mode == "walk":
        if tags.get("foot") in ("no", "private"):
            return False
    else:
        for k in ("motor_vehicle", "motorcar", "vehicle"):
            if tags.get(k) in ("no", "private"):
                return False
        if tags.get("service") == "parking_aisle":
            return False
    if tags.get("area") == "yes":
        return False
    return True

def oneway_dirs(tags):
    """Return (forward, backward) booleans for a car way."""
    val = str(tags.get("oneway", "")).lower()
    if val in ("yes", "true", "1") or tags.get("junction") == "roundabout":
        return True, False
    if val in ("-1", "reverse"):
        return False, True
    return True, True

def maxspeed(tags, hw):
    raw = str(tags.get("maxspeed", ""))
    try:
        v = float(raw.split()[0])
        if v < 5:  # mph-ish / malformed
            v = v * 1.609
        return max(10, min(v, 80))
    except Exception:
        return CAR_SPEED.get(hw, 20)

def is_connector(tags):
    return tags.get("highway") in ("motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link")

def build_mode(osm, mode, places):
    bbox = osm["bbox"]
    raw_nodes = osm["nodes"]
    adj = defaultdict(list)
    node_set = set()
    edge_count = 0

    for way in osm["ways"]:
        tags = way["tags"]
        hw = tags.get("highway", "")
        if mode == "walk":
            if hw not in WALK_ALLOWED:
                continue
            if hw in ("motorway", "motorway_link", "trunk", "trunk_link"):
                if tags.get("foot") not in ("yes", "designated", "permissive"):
                    continue
            if not access_allowed(tags, mode):
                continue
            speed = WALK_SPEED.get(hw, 4.5)
            if tags.get("steps") == "yes" or hw == "steps":
                speed = WALK_SPEED["steps"]
        else:
            if hw not in CAR_ALLOWED:
                continue
            if not access_allowed(tags, mode):
                continue
            speed = maxspeed(tags, hw)
            # taxi estimate: no traffic, city factor
            speed = min(speed, 55) * 0.8

        refs = way["nodes"]
        fwd, bwd = (True, True) if mode == "walk" else oneway_dirs(tags)
        for i in range(len(refs) - 1):
            a, b = str(refs[i]), str(refs[i + 1])
            pa, pb = raw_nodes.get(a), raw_nodes.get(b)
            if not pa or not pb:
                continue
            # keep ways that touch the city bbox at least once
            if not (bbox[0] <= pa[0] <= bbox[2] and bbox[1] <= pa[1] <= bbox[3]) and \
               not (bbox[0] <= pb[0] <= bbox[2] and bbox[1] <= pb[1] <= bbox[3]):
                continue
            d = hav(pa[0], pa[1], pb[0], pb[1])
            if d < 0.5 or d > 3000:
                continue
            t = d / (speed / 3.6)
            if hw == "elevator":
                t += 30  # wait/ride estimate
            node_set.add(a); node_set.add(b)
            if fwd:
                adj[a].append((b, d, t))
            if bwd:
                adj[b].append((a, d, t))
            edge_count += 1

    # Compact indices, keep only nodes with at least one edge.
    ids = sorted(node_set, key=lambda x: int(x))
    index = {nid: i for i, nid in enumerate(ids)}
    nodes = []
    for nid in ids:
        lon, lat = raw_nodes[nid]
        nodes.append([lon, lat])
    adj_out = []
    for nid in ids:
        row = []
        for to, d, t in adj.get(nid, []):
            if to in index:
                row.append([index[to], round(d, 1), round(t, 1)])
        adj_out.append(row)

    # Largest weakly connected component (both directions).
    und = [[] for _ in ids]
    for nid in ids:
        i = index[nid]
        for to, _, _ in adj.get(nid, []):
            j = index.get(to)
            if j is not None:
                und[i].append(j)
                und[j].append(i)
    seen = bytearray(len(ids))
    best = []
    for start in range(len(ids)):
        if seen[start]:
            continue
        q = deque([start]); seen[start] = 1; comp = []
        while q:
            u = q.popleft(); comp.append(u)
            for v in und[u]:
                if not seen[v]:
                    seen[v] = 1; q.append(v)
        if len(comp) > len(best):
            best = comp
    keep = set(best)
    remap = {}
    out_nodes = []
    for i in best:
        remap[i] = len(out_nodes)
        out_nodes.append(nodes[i])
    out_adj = []
    for i in best:
        row = []
        for to, d, t in adj_out[i]:
            j = remap.get(to)
            if j is not None:
                row.append([j, d, t])
        out_adj.append(row)

    # Snap places to nearest node in the largest component.
    place_out = {}
    for key, p in places.items():
        best_i, best_d = 0, float("inf")
        for i, (lon, lat) in enumerate(out_nodes):
            d = hav(p["lon"], p["lat"], lon, lat)
            if d < best_d:
                best_d, best_i = d, i
        place_out[key] = {
            "name": p["name"], "lon": p["lon"], "lat": p["lat"],
            "node": best_i, "snap_m": round(best_d, 1),
        }

    return {
        "city": osm["city"], "name": osm["name"], "mode": mode,
        "bbox": bbox,
        "source": osm["source"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "stats": {
            "nodes": len(out_nodes), "edges": sum(len(r) for r in out_adj),
            "raw_nodes": len(ids), "raw_edges": edge_count,
            "places": len(places),
        },
        "nodes": out_nodes,
        "adj": out_adj,
        "places": place_out,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city", choices=["chongqing", "wuhan", "guiyang"])
    args = ap.parse_args()
    osm_path = os.path.join(DATA, f"{args.city}-osm.json")
    places_path = os.path.join(ROOT, "spikes", "places-routes.json")
    osm = json.load(open(osm_path))
    places = json.load(open(places_path))[args.city]["places"]

    for mode in ("walk", "car"):
        t0 = time.time()
        print(f"[{args.city}/{mode}] building graph ...", flush=True)
        g = build_mode(osm, mode, places)
        out = os.path.join(DATA, f"{args.city}-{mode}.json")
        with open(out, "w") as f:
            json.dump(g, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[{args.city}/{mode}] nodes={g['stats']['nodes']} edges={g['stats']['edges']} "
              f"places={len(g['places'])} {time.time()-t0:.1f}s {os.path.getsize(out)/1e6:.1f} MB", flush=True)
        print(f"[{args.city}/{mode}] snaps:", flush=True)
        for k, p in g["places"].items():
            print(f"   {p['name']:<12} {p['snap_m']:.0f} m", flush=True)

if __name__ == "__main__":
    main()
