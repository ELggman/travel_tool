const blobByPath = new Map<string, string>();
const loadedCities = new Set<string>();
const loading = new Map<string, Promise<void>>();

const key = (city: string, path: string) => `${city}:${path}`;

/** Materialize cached MVT entries as blob URLs. MapLibre workers can fetch blob URLs reliably. */
export function ensureTileUrls(city: string): Promise<void> {
  if (loadedCities.has(city)) return Promise.resolve();
  const existing = loading.get(city);
  if (existing) return existing;
  const task = (async () => {
    const cache = await caches.open(`yanlu-pack-${city}`);
    const requests = (await cache.keys()).filter((req) => new URL(req.url).pathname.endsWith('.mvt'));
    await Promise.all(requests.map(async (req) => {
      const path = new URL(req.url).pathname;
      if (blobByPath.has(key(city, path))) return;
      const response = await cache.match(req);
      if (!response) return;
      const blob = await response.blob();
      blobByPath.set(key(city, path), URL.createObjectURL(blob));
    }));
    loadedCities.add(city);
  })();
  loading.set(city, task);
  return task;
}

export function getTileBlobUrl(city: string, path: string): string | undefined {
  return blobByPath.get(key(city, path));
}

export function releaseTileUrls(city: string): void {
  for (const [k, url] of blobByPath) {
    if (k.startsWith(`${city}:`)) {
      URL.revokeObjectURL(url);
      blobByPath.delete(k);
    }
  }
  loadedCities.delete(city);
  loading.delete(city);
}
