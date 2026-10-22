/**
 * Local A* routing spike for YANLU.
 *
 * Reads spikes/data/<city>-walk.json, <city>-car.json and
 * spikes/places-routes.json; writes route GeoJSON + a metric summary.
 *
 * Run: node spikes/routing/astar.ts chongqing
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

type Graph = {
  city: string;
  name: string;
  mode: "walk" | "car";
  nodes: [number, number][];
  adj: [number, number, number][][];
  places: Record<string, { name: string; lon: number; lat: number; node: number; snap_m: number }>;
  stats: { nodes: number; edges: number };
};

type RouteDef = { id: string; from: string; to: string; mode: "walk" | "car" };
type PlaceDef = { name: string; lon: number; lat: number };
type PlacesFile = Record<string, { places: Record<string, PlaceDef>; routes: RouteDef[] }>;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA = path.join(ROOT, "spikes", "data");
const OUT = path.join(ROOT, "spikes", "out");

const EARTH_R = 6371000;
const RAD = Math.PI / 180;

function hav(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = (lat2 - lat1) * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, key: number): void {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): [number, number] {
    const id = this.ids[0], key = this.keys[0];
    const lastId = this.ids.pop()!, lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return [id, key];
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

function astar(g: Graph, start: number, goal: number) {
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const maxSpeedMps = (g.mode === "walk" ? 6 : 80) / 3.6;
  const [glon, glat] = g.nodes[goal];
  const h = (i: number) => hav(g.nodes[i][0], g.nodes[i][1], glon, glat) / maxSpeedMps;
  const heap = new Heap();
  gScore[start] = 0;
  heap.push(start, h(start));
  let expanded = 0;
  while (heap.size) {
    const [u] = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    expanded++;
    if (u === goal) break;
    for (const [v, distance, time] of g.adj[u]) {
      const tentative = gScore[u] + time;
      if (tentative < gScore[v]) {
        gScore[v] = tentative;
        cameFrom[v] = u;
        heap.push(v, tentative + h(v));
      }
    }
  }
  if (!Number.isFinite(gScore[goal])) {
    return { ok: false as const, expanded };
  }
  const path: number[] = [];
  let cur = goal;
  while (cur !== -1) {
    path.push(cur);
    if (cur === start) break;
    cur = cameFrom[cur];
  }
  path.reverse();
  if (path[0] !== start) return { ok: false as const, expanded };
  let distance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const edge = g.adj[a].find((e) => e[0] === b);
    distance += edge ? edge[1] : hav(g.nodes[a][0], g.nodes[a][1], g.nodes[b][0], g.nodes[b][1]);
  }
  return { ok: true as const, path, distance, timeSec: gScore[goal], expanded };
}

function main() {
  const city = process.argv[2];
  if (!city) throw new Error("usage: node spikes/routing/astar.ts <city>");
  const placesAll: PlacesFile = JSON.parse(fs.readFileSync(path.join(ROOT, "spikes", "places-routes.json"), "utf8"));
  const cfg = placesAll[city];
  if (!cfg) throw new Error(`unknown city: ${city}`);

  const graphs: Record<string, Graph> = {};
  for (const mode of ["walk", "car"] as const) {
    const p = path.join(DATA, `${city}-${mode}.json`);
    if (fs.existsSync(p)) graphs[mode] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  fs.mkdirSync(OUT, { recursive: true });

  const features: any[] = [];
  const summaries: any[] = [];
  const tAll = performance.now();

  for (const route of cfg.routes) {
    const g = graphs[route.mode];
    if (!g) { summaries.push({ ...route, ok: false, error: "missing graph" }); continue; }
    const from = g.places[route.from];
    const to = g.places[route.to];
    if (!from || !to) { summaries.push({ ...route, ok: false, error: "missing place" }); continue; }
    const t0 = performance.now();
    const res = astar(g, from.node, to.node);
    const ms = performance.now() - t0;
    if (!res.ok) {
      summaries.push({
        ...route, ok: false, error: "no route", ms: Math.round(ms * 10) / 10,
        fromSnapM: from.snap_m, toSnapM: to.snap_m, expanded: res.expanded,
      });
      console.log(`${route.id} ${route.mode} FAILED (${res.expanded} expanded, ${ms.toFixed(1)}ms)`);
      continue;
    }
    const coords = res.path.map((i) => [g.nodes[i][0], g.nodes[i][1]]);
    const durationMin = res.timeSec / 60;
    const summary = {
      id: route.id, mode: route.mode,
      from: from.name, to: to.name,
      fromKey: route.from, toKey: route.to,
      ok: true,
      distanceM: Math.round(res.distance),
      durationMin: Math.round(durationMin * 10) / 10,
      avgSpeedKmh: Math.round((res.distance / 1000) / (durationMin / 60) * 10) / 10,
      nodes: res.path.length,
      expanded: res.expanded,
      ms: Math.round(ms * 10) / 10,
      fromSnapM: from.snap_m,
      toSnapM: to.snap_m,
      start: coords[0], end: coords[coords.length - 1],
    };
    summaries.push(summary);
    features.push({
      type: "Feature",
      properties: {
        id: route.id,
        mode: route.mode,
        from: from.name,
        to: to.name,
        distanceM: summary.distanceM,
        durationMin: summary.durationMin,
        source: "local-astar",
      },
      geometry: { type: "LineString", coordinates: coords },
    });
    console.log(
      `${route.id} ${route.mode.padEnd(4)} ${String(summary.distanceM).padStart(6)} m ` +
      `${String(summary.durationMin).padStart(5)} min  ${String(summary.ms).padStart(6)} ms  ` +
      `${String(summary.expanded).padStart(6)} exp  ${from.name} → ${to.name}`
    );
  }

  const summary = {
    city, generated_at: new Date().toISOString(),
    graphs: Object.fromEntries(Object.entries(graphs).map(([m, g]) => [m, g.stats])),
    routes: summaries,
    totalMs: Math.round((performance.now() - tAll) * 10) / 10,
    okCount: summaries.filter((s) => s.ok).length,
    failCount: summaries.filter((s) => !s.ok).length,
  };
  fs.writeFileSync(path.join(OUT, `${city}-routes.json`), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, `${city}-routes.geojson`), JSON.stringify({ type: "FeatureCollection", features }, null, 2));
  console.log(`\n${city}: ${summary.okCount}/${summaries.length} routes, total ${summary.totalMs} ms`);
  console.log(`wrote spikes/out/${city}-routes.json and .geojson`);
}

main();
