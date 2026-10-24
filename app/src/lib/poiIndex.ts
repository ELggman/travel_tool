export type PoiEntry = {
  name: string;
  kind: string;
  kindValue: string;
  lon: number;
  lat: number;
  nameEn?: string;
};

const cache = new Map<string, Promise<PoiEntry[]>>();

export function loadPoiIndex(city: string): Promise<PoiEntry[]> {
  const hit = cache.get(city);
  if (hit) return hit;
  const task = fetch(`/poi/${city}.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((data: PoiEntry[]) => (Array.isArray(data) ? data : []))
    .catch(() => []);
  cache.set(city, task);
  return task;
}
