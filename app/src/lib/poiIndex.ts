import { getPackBaseUrl } from '../config';
import { cacheName, cacheSupported, cacheUrl } from './packCache';

export type PoiEntry = {
  name: string;
  kind: string;
  kindValue: string;
  lon: number;
  lat: number;
  nameEn?: string;
};

const cache = new Map<string, Promise<PoiEntry[]>>();

async function readFromPack(city: string): Promise<PoiEntry[]> {
  if (!cacheSupported()) return [];
  const pack = await caches.open(cacheName(city, 'standard'));
  const hit = await pack.match(cacheUrl(city, 'pois.json'));
  if (hit) return await hit.json();

  // Migration for packs downloaded before the index was bundled. The sidecar
  // is written next to the city archive and cached into the same pack cache.
  const response = await fetch(`${getPackBaseUrl()}/packs/${city}-pois.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`POI 索引下载失败 HTTP ${response.status}`);
  const text = await response.text();
  await pack.put(
    new Request(cacheUrl(city, 'pois.json')),
    new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
  );
  return JSON.parse(text) as PoiEntry[];
}

export function loadPoiIndex(city: string): Promise<PoiEntry[]> {
  const hit = cache.get(city);
  if (hit) return hit;
  const task = readFromPack(city).then((data) => (Array.isArray(data) ? data : []));
  cache.set(city, task);
  task.catch(() => cache.delete(city));
  return task;
}
