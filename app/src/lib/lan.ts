export type LanInfo = {
  ok?: boolean;
  ip: string;
  port: number;
  room: string;
  version: number;
  error?: string;
};

type LanBridge = {
  start(): string;
  stop(): string;
  info(): string;
  publish(json: string): string;
  publishAt?(json: string, baseVersion: number): string;
};

declare global {
  interface Window { YanluLan?: LanBridge }
}

export function lanSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.YanluLan);
}

function bridge(): LanBridge {
  if (!window.YanluLan) throw new Error('当前环境不是 Android 局域网壳');
  return window.YanluLan;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3500);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export function startLanHost(): LanInfo {
  return JSON.parse(bridge().start()) as LanInfo;
}

export function stopLanHost(): void {
  bridge().stop();
}

export function publishLanSnapshot(info: LanInfo, trip: unknown, baseVersion?: number): { ok: boolean; version?: number; error?: string } {
  const payload = JSON.stringify(trip);
  const raw = baseVersion !== undefined && baseVersion >= 0 && bridge().publishAt
    ? bridge().publishAt!(payload, baseVersion)
    : bridge().publish(payload);
  return JSON.parse(raw);
}

export async function fetchLanSnapshot(info: Pick<LanInfo, 'ip' | 'port' | 'room'>): Promise<{ ok: boolean; version: number; trip: unknown }> {
  const url = `http://${info.ip}:${info.port}/snapshot?room=${encodeURIComponent(info.room)}`;
  const response = await request(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export async function pushLanSnapshot(info: Pick<LanInfo, 'ip' | 'port' | 'room'>, trip: unknown, baseVersion?: number): Promise<{ ok: boolean; version?: number; error?: string }> {
  const suffix = baseVersion === undefined ? '' : `&baseVersion=${baseVersion}`;
  const url = `http://${info.ip}:${info.port}/snapshot?room=${encodeURIComponent(info.room)}${suffix}`;
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trip),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return { ok: false, version: data.version, error: data.error ?? `HTTP ${response.status}` };
  return data;
}

export async function probeLan(info: Pick<LanInfo, 'ip' | 'port' | 'room'>): Promise<LanInfo> {
  const response = await request(`http://${info.ip}:${info.port}/info?room=${encodeURIComponent(info.room)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export async function pingLan(
  info: Pick<LanInfo, 'ip' | 'port' | 'room'>,
  id: string,
  name: string,
): Promise<{ ok: boolean; members: string[] }> {
  const url = `http://${info.ip}:${info.port}/hello?room=${encodeURIComponent(info.room)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
  const response = await request(url, { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export async function fetchLanMembers(
  info: Pick<LanInfo, 'ip' | 'port' | 'room'>,
): Promise<string[]> {
  const response = await request(`http://${info.ip}:${info.port}/members?room=${encodeURIComponent(info.room)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.members) ? data.members : [];
}

export async function leaveLan(
  info: Pick<LanInfo, 'ip' | 'port' | 'room'>,
  id: string,
): Promise<{ ok: boolean; members: string[] }> {
  const url = `http://${info.ip}:${info.port}/leave?room=${encodeURIComponent(info.room)}&id=${encodeURIComponent(id)}`;
  const response = await request(url, { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}
