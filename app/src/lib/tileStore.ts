import type { PackVariant } from './packCache';

const blobByPath = new Map<string, string>();
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

const storeKey = (city: string, variant: PackVariant, path: string) => `${city}:${variant}:${path}`;
const cacheKey = (city: string, variant: PackVariant) =>
  `yanlu-pack-${city}${variant === 'fine' ? '-fine' : ''}`;

/** Materialize cached MVT entries as blob URLs. MapLibre workers can fetch blob URLs reliably. */
export function ensureTileUrls(city: string, variant: PackVariant = 'standard'): Promise<void> {
  const key = `${city}:${variant}`;
  if (loaded.has(key)) return Promise.resolve();
  const existing = loading.get(key);
  if (existing) return existing;
  const task = (async () => {
    const cache = await caches.open(cacheKey(city, variant));
    const requests = (await cache.keys()).filter((req) => new URL(req.url).pathname.endsWith('.mvt'));
    await Promise.all(requests.map(async (req) => {
      const path = new URL(req.url).pathname;
      const pathKey = storeKey(city, variant, path);
      if (blobByPath.has(pathKey)) return;
      const response = await cache.match(req);
      if (!response) return;
      const blob = await response.blob();
      blobByPath.set(pathKey, URL.createObjectURL(blob));
    }));
    loaded.add(key);
  })();
  loading.set(key, task);
  return task;
}

export function getTileBlobUrl(city: string, path: string, variant: PackVariant = 'standard'): string | undefined {
  return blobByPath.get(storeKey(city, variant, path));
}

export function releaseTileUrls(city: string, variant?: PackVariant): void {
  const prefixes = variant
    ? [`${city}:${variant}:`]
    : [`${city}:standard:`, `${city}:fine:`];
  for (const [key, url] of blobByPath) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      URL.revokeObjectURL(url);
      blobByPath.delete(key);
    }
  }
  for (const key of [...loaded]) {
    if (prefixes.some((prefix) => key.startsWith(`${city}:`))) loaded.delete(key);
  }
  for (const key of [...loading.keys()]) {
    if (prefixes.some((prefix) => key.startsWith(`${city}:`))) loading.delete(key);
  }
}
