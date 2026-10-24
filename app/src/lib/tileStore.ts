import type { PackVariant } from './packCache';

const blobByPath = new Map<string, string>();
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

const storeKey = (city: string, variant: PackVariant, path: string) => `${city}:${variant}:${path}`;
const cacheKey = (city: string, variant: PackVariant) =>
  `yanlu-pack-v2-${city}${variant === 'fine' ? '-fine3' : ''}`;

const zoomOf = (path: string) => Number(path.split('/')[4] ?? 0);
const tileXY = (path: string) => { const p = path.split('/'); return [Number(p[5]), Number(p[6]?.replace('.mvt', '') ?? 0)] as const; };

export type BBox = [number, number, number, number];

/**
 * Materialize cached MVT entries as blob URLs. Low zooms are loaded first so
 * the first map frame is not blocked by reading all high-zoom tiles.
 */
export function ensureTileUrls(city: string, variant: PackVariant = 'standard', bbox?: BBox): Promise<void> {
  const key = `${city}:${variant}`;
  if (loaded.has(key)) return Promise.resolve();
  const existing = loading.get(key);
  if (existing) return existing;
  const task = (async () => {
    const cache = await caches.open(cacheKey(city, variant));
    const requests = (await cache.keys())
      .filter((req) => new URL(req.url).pathname.endsWith('.mvt'))
      .map((req) => ({ path: new URL(req.url).pathname, request: req }))
      .sort((a, b) => zoomOf(a.path) - zoomOf(b.path));
    const materialize = async (item: { path: string; request: Request }) => {
      const pathKey = storeKey(city, variant, item.path);
      if (blobByPath.has(pathKey)) return;
      const response = await cache.match(item.request);
      if (!response) return;
      const blob = await response.blob();
      blobByPath.set(pathKey, URL.createObjectURL(blob));
    };
    const inBBox = (path: string) => {
      if (!bbox) return true;
      const z = zoomOf(path);
      const [x, y] = tileXY(path);
      const [w, s, e, n] = bbox;
      const count = 2 ** z;
      const tx0 = Math.floor((w + 180) / 360 * count);
      const tx1 = Math.floor((e + 180) / 360 * count);
      const ty0 = Math.floor((1 - Math.log(Math.tan(s * Math.PI / 180) + 1 / Math.cos(s * Math.PI / 180)) / Math.PI) / 2 * count);
      const ty1 = Math.floor((1 - Math.log(Math.tan(n * Math.PI / 180) + 1 / Math.cos(n * Math.PI / 180)) / Math.PI) / 2 * count);
      return x >= tx0 - 1 && x <= tx1 + 1 && y >= ty0 - 1 && y <= ty1 + 1;
    };
    const low = variant === 'fine' ? requests : requests.filter((item) => zoomOf(item.path) <= 13);
    const highNow = variant === 'standard'
      ? requests.filter((item) => zoomOf(item.path) > 13 && inBBox(item.path))
      : [];
    await Promise.all([...low, ...highNow].map(materialize));
    if (variant === 'standard') {
      const rest = requests.filter((item) => zoomOf(item.path) > 13 && !inBBox(item.path));
      void Promise.all(rest.map(materialize))
        .then(() => loaded.add(key))
        .catch(() => {});
    } else {
      loaded.add(key);
    }
  })();
  loading.set(key, task);
  return task;
}

export function getTileBlobUrl(city: string, path: string, variant: PackVariant = 'standard'): string | undefined {
  return blobByPath.get(storeKey(city, variant, path));
}

export function releaseTileUrls(city: string, variant?: PackVariant): void {
  const variants = variant ? [variant] : ['standard', 'fine'] as PackVariant[];
  for (const v of variants) {
    for (const [key, url] of blobByPath) {
      if (key.startsWith(`${city}:${v}:`)) {
        URL.revokeObjectURL(url);
        blobByPath.delete(key);
      }
    }
    loaded.delete(`${city}:${v}`);
    loading.delete(`${city}:${v}`);
  }
}
