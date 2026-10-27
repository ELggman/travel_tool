import { gunzipSync, unzipSync } from 'fflate';
import { getPackBaseUrl } from '../config';

export type DownloadProgress = (pct: number) => void;
export type PackVariant = 'standard' | 'fine';

const CACHE_NAMESPACE = 'yanlu-pack-v2-';
export const cacheName = (city: string, variant: PackVariant) =>
  `${CACHE_NAMESPACE}${city}${variant === 'fine' ? '-fine3' : ''}`;

export const cacheUrl = (city: string, name: string, variant: PackVariant = 'standard') =>
  `https://yanlu.local/packs/${city}${variant === 'fine' ? '-fine' : ''}/${name}`;

export function cacheSupported(): boolean {
  return typeof caches !== 'undefined';
}

export async function listCachedPacks(variant: PackVariant = 'standard'): Promise<string[]> {
  if (!cacheSupported()) return [];
  const all = await caches.keys();
  // Invalidate pre-v2 packs when the archive format/coverage changes.
  const legacy = all.filter((key) => (key.startsWith('yanlu-pack-') && !key.startsWith(CACHE_NAMESPACE)) || key.endsWith('-fine'));
  await Promise.all(legacy.map((key) => caches.delete(key)));
  const keys = all.filter((key) => {
    if (!key.startsWith(CACHE_NAMESPACE)) return false;
    return variant === 'fine' ? key.endsWith('-fine3') : !key.endsWith('-fine3');
  });
  const valid: string[] = [];
  for (const key of keys) {
    const suffix = variant === 'fine' ? '-fine3' : '';
    const city = key.slice(CACHE_NAMESPACE.length, key.length - suffix.length);
    if (!city) {
      await caches.delete(key);
      continue;
    }
    const cache = await caches.open(key);
    const manifest = await cache.match(cacheUrl(city, 'manifest.json', variant));
    const walk = variant === 'standard'
      ? await cache.match(cacheUrl(city, 'walk.json', variant))
      : manifest;
    if (manifest && walk) valid.push(city);
    else await caches.delete(key);
  }
  return valid;
}

export async function deleteCachedPack(city: string, variant: PackVariant = 'standard'): Promise<void> {
  if (!cacheSupported()) return;
  await caches.delete(cacheName(city, variant));
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyArchiveHash(base: string, archive: string, data: Uint8Array): Promise<void> {
  if (!crypto.subtle) throw new Error('当前环境不支持 SHA-256 校验');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  let response: Response;
  try {
    response = await fetch(`${base}/packs/${archive}.yanlu-pack.zip.sha256`, {
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new Error('无法读取地图包 SHA-256 校验文件');
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`地图包缺少 SHA-256 校验文件 HTTP ${response.status}`);
  const expected = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error('地图包 SHA-256 校验文件格式不正确');
  const actual = await sha256Hex(new Uint8Array(data).buffer);
  if (actual !== expected) throw new Error('地图包 SHA-256 校验失败，文件可能损坏或被篡改');
}

export async function downloadPackArchive(
  city: string,
  onProgress: DownloadProgress,
  variant: PackVariant = 'standard',
): Promise<void> {
  if (!cacheSupported()) throw new Error('当前 WebView 不支持 CacheStorage');
  onProgress(1);
  const base = getPackBaseUrl();
  const archive = variant === 'fine' ? `${city}-fine` : city;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${base}/packs/${archive}.yanlu-pack.zip`, {
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

  await verifyArchiveHash(base, archive, buffer);
  onProgress(60);
  const files = unzipSync(buffer);
  const entries = Object.entries(files).filter(([name]) => !name.endsWith('/'));
  if (!entries.some(([name]) => name.endsWith('manifest.json'))) {
    throw new Error('归档缺少 manifest.json');
  }

  const cache = await caches.open(cacheName(city, variant));
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
      new Request(cacheUrl(city, name, variant)),
      new Response(body, { headers }),
    );
    done += 1;
    if (done % 24 === 0 || done === entries.length) {
      onProgress(60 + Math.round((done / entries.length) * 39));
    }
  }
  onProgress(100);
}

export async function cacheEntryCount(city: string, variant: PackVariant = 'standard'): Promise<number> {
  if (!cacheSupported()) return 0;
  const cache = await caches.open(cacheName(city, variant));
  return (await cache.keys()).length;
}
