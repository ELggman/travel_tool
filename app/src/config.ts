/** Pack archives are external to the APK; replace this with the CDN URL in production. */
const isAndroid = /Android/i.test(navigator.userAgent);
const DEFAULT_BASE = isAndroid ? 'http://10.0.2.2:8090' : 'http://127.0.0.1:8090';

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getPackBaseUrl(): string {
  const queryBase = new URLSearchParams(location.search).get('packBase');
  if (queryBase) return normalize(queryBase);
  try {
    const stored = localStorage.getItem('yanlu.pack.base');
    if (stored) return normalize(stored);
  } catch {
    // ignore storage failures
  }
  return normalize(import.meta.env.VITE_PACK_BASE_URL || DEFAULT_BASE);
}

export function setPackBaseUrl(value: string): void {
  try {
    const normalized = normalize(value);
    if (normalized) localStorage.setItem('yanlu.pack.base', normalized);
    else localStorage.removeItem('yanlu.pack.base');
  } catch {
    // ignore storage failures
  }
}
