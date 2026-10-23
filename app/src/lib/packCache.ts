import { gunzipSync, unzipSync } from 'fflate';
import { getPackBaseUrl } from '../config';

export type DownloadProgress = (pct: number) => void;

const cacheName = (city: string) => `yanlu-pack-${city}`;
export const cacheUrl = (city: string, name: string) => `https://yanlu.local/packs/${city}/${name}`;

export function cacheSupported(): boolean {
  return typeof caches !== 'undefined';
}

export async function listCachedPacks(): Promise<string[]> {
  if (!cacheSupported()) return [];
  const keys = (await caches.keys()).filter((key) => key.startsWith('yanlu-pack-'));
  const valid: string[] = [];
  for (const key of keys) {
    const city = key.slice('yanlu-pack-'.length);
    if (!city) {
      await caches.delete(key);
      continue;
    }
    const cache = await caches.open(key);
    const manifest = await cache.match(cacheUrl(city, 'manifest.json'));
    const walk = await cache.match(cacheUrl(city, 'walk.json'));
    if (manifest && walk) valid.push(city);
    else await caches.delete(key);
  }
  return valid;
}

export async function deleteCachedPack(city: string): Promise<void> {
  if (!cacheSupported()) return;
  await caches.delete(cacheName(city));
}

export async function downloadPackArchive(city: string, onProgress: DownloadProgress): Promise<void> {
  if (!cacheSupported()) throw new Error('当前 WebView 不支持 CacheStorage');
  onProgress(1);
  const base = getPackBaseUrl();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${base}/packs/${city}.yanlu-pack.zip`, {
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`连接包服务器超时：${base}。真机请填写 Mac 的局域网 IP，例如 http://192.168.1.10:8090`);
    }
    throw new Error(`无法连接包服务器：${base}。请确认手机与 Mac 在同一网络，且 pack server 已启动`);
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`归档下载失败 HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取下载流');
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    const pct = total ? Math.min(58, Math.round((loaded / total) * 58)) : 25;
    onProgress(pct);
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress(60);
  const files = unzipSync(buffer);
  const entries = Object.entries(files).filter(([name]) => !name.endsWith('/'));
  if (!entries.some(([name]) => name.endsWith('manifest.json'))) {
    throw new Error('归档缺少 manifest.json');
  }

  const cache = await caches.open(cacheName(city));
  let done = 0;
  for (const [name, data] of entries) {
    const isMvt = name.toLowerCase().endsWith('.mvt');
    // Store raw MVT bytes. Custom protocol responses cannot carry Content-Encoding reliably.
    const body = isMvt ? gunzipSync(data) : data;
    const headers: Record<string, string> = isMvt
      ? { 'Content-Type': 'application/x-protobuf' }
      : name.endsWith('.json')
        ? { 'Content-Type': 'application/json; charset=utf-8' }
        : { 'Content-Type': 'application/octet-stream' };
    await cache.put(
      new Request(cacheUrl(city, name)),
      new Response(body, { headers }),
    );
    done += 1;
    if (done % 24 === 0 || done === entries.length) {
      onProgress(60 + Math.round((done / entries.length) * 39));
    }
  }
  onProgress(100);
}

export async function cacheEntryCount(city: string): Promise<number> {
  if (!cacheSupported()) return 0;
  const cache = await caches.open(cacheName(city));
  return (await cache.keys()).length;
}
