/** Local A* worker. Graph is compact JSON: nodes + adjacency [to, meters, seconds]. */
type Graph = {
  nodes: [number, number][];
  adj: [number, number, number][][];
};

type RouteRequest = {
  type?: 'route';
  id: number;
  city: string;
  mode: 'walk' | 'taxi';
  from: [number, number];
  to: [number, number];
};

type GraphRef = {
  type: 'graph-ref';
  city: string;
  mode: 'walk' | 'taxi';
  cacheName: string;
  url: string;
};

const graphs = new Map<string, Graph>();
const graphPromises = new Map<string, Promise<Graph>>();

function loadGraph(ref: GraphRef): Promise<Graph> {
  const key = `${ref.city}-${ref.mode}`;
  const existing = graphPromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const cache = await caches.open(ref.cacheName);
    const hit = await cache.match(ref.url);
    if (!hit) throw new Error(`graph cache missing: ${key}`);
    const graph = await hit.json() as Graph;
    graphs.set(key, graph);
    self.postMessage({ type: 'graph-ready', key });
    return graph;
  })();
  graphPromises.set(key, promise);
  return promise;
}
const EARTH_R = 6371000;
const RAD = Math.PI / 180;

function hav(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = (lat2 - lat1) * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.ids[i], this.ids[p]] = [this.ids[p], this.ids[i]];
      [this.keys[i], this.keys[p]] = [this.keys[p], this.keys[i]];
      i = p;
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
        [this.ids[i], this.ids[m]] = [this.ids[m], this.ids[i]];
        [this.keys[i], this.keys[m]] = [this.keys[m], this.keys[i]];
        i = m;
      }
    }
    return [id, key];
  }
}

function nearest(nodes: [number, number][], p: [number, number]) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = hav(p[0], p[1], nodes[i][0], nodes[i][1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, distance: bestD };
}

function astar(g: Graph, start: number, goal: number) {
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const glon = g.nodes[goal][0], glat = g.nodes[goal][1];
  const maxMps = 80 / 3.6;
  const h = (i: number) => hav(g.nodes[i][0], g.nodes[i][1], glon, glat) / maxMps;
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
    for (const [v, , time] of g.adj[u]) {
      const tentative = gScore[u] + time;
      if (tentative < gScore[v]) {
        gScore[v] = tentative;
        came[v] = u;
        heap.push(v, tentative + h(v));
      }
    }
  }
  if (!Number.isFinite(gScore[goal])) return { ok: false as const, expanded };
  const path: number[] = [];
  let cur = goal;
  while (cur !== -1) {
    path.push(cur);
    if (cur === start) break;
    cur = came[cur];
  }
  path.reverse();
  if (path[0] !== start) return { ok: false as const, expanded };
  return { ok: true as const, path, timeSec: gScore[goal], expanded };
}

self.postMessage({ type: 'worker-ready' });

self.onmessage = async (event: MessageEvent<RouteRequest | GraphRef>) => {
  const msg = event.data;
  if (msg.type === 'graph-ref') {
    loadGraph(msg).catch((err) => console.warn('[yanlu worker] graph load failed', err));
    return;
  }
  const req = msg;
  try {
    const g = graphs.get(`${req.city}-${req.mode}`) ?? await loadGraph({
      type: 'graph-ref',
      city: req.city,
      mode: req.mode,
      cacheName: `yanlu-pack-v2-${req.city}`,
      url: `https://yanlu.local/packs/${req.city}/${req.mode === 'walk' ? 'walk' : 'car'}.json`,
    });
    if (!g) {
      self.postMessage({ id: req.id, ok: false, error: 'graph not loaded' });
      return;
    }
    const a = nearest(g.nodes, req.from);
    const b = nearest(g.nodes, req.to);
    const res = astar(g, a.index, b.index);
    if (!res.ok) {
      self.postMessage({ id: req.id, ok: false, error: 'no route' });
      return;
    }
    const coordinates = res.path.map((i) => g.nodes[i]);
    let distance = 0;
    for (let i = 0; i < res.path.length - 1; i++) {
      const from = res.path[i], to = res.path[i + 1];
      const edge = g.adj[from].find((e) => e[0] === to);
      distance += edge ? edge[1] : hav(g.nodes[from][0], g.nodes[from][1], g.nodes[to][0], g.nodes[to][1]);
    }
    self.postMessage({
      id: req.id,
      ok: true,
      coordinates,
      distanceM: Math.round(distance),
      durationMin: Math.round((res.timeSec / 60) * 10) / 10,
      snapFromM: Math.round(a.distance),
      snapToM: Math.round(b.distance),
      expanded: res.expanded,
    });
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: String(err) });
  }
};
