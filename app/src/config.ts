/** Pack archives are intentionally external to the APK; replace this with the CDN URL in production. */
const isAndroid = /Android/i.test(navigator.userAgent);
const queryBase = new URLSearchParams(location.search).get('packBase');
const storedBase = (() => {
  try { return localStorage.getItem('yanlu.pack.base'); } catch { return null; }
})();

export const PACK_BASE_URL = (
  queryBase
  || storedBase
  || import.meta.env.VITE_PACK_BASE_URL
  || (isAndroid ? 'http://10.0.2.2:8090' : 'http://127.0.0.1:8090')
).replace(/\/$/, '');
