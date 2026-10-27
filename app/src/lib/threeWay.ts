export type MergeResult = { value: unknown; conflicts: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((key) => equal(a[key], b[key]));
  }
  return false;
}

function keyedArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => isPlainObject(item) && typeof item.id === 'string');
}

function orderChanged(baseIds: string[], values: string[]): boolean {
  const baseSet = new Set(baseIds);
  const present = values.filter((id) => baseSet.has(id));
  const basePresent = baseIds.filter((id) => values.includes(id));
  return present.join('|') !== basePresent.join('|');
}

function mergeKeyedArray(base: Record<string, unknown>[], local: Record<string, unknown>[], remote: Record<string, unknown>[], path: string): MergeResult {
  const conflicts: string[] = [];
  const baseMap = new Map(base.map((item) => [item.id as string, item]));
  const localMap = new Map(local.map((item) => [item.id as string, item]));
  const remoteMap = new Map(remote.map((item) => [item.id as string, item]));
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const out = new Map<string, Record<string, unknown>>();

  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (!l && !r) continue;
    if (!b) {
      if (l && r) {
        if (equal(l, r)) out.set(id, l);
        else {
          conflicts.push(`${path}[${id}]`);
          out.set(id, l);
        }
      } else {
        out.set(id, (l ?? r)!);
      }
      continue;
    }
    if (!l) {
      if (equal(r, b)) continue; // deleted locally
      conflicts.push(`${path}[${id}]`);
      continue;
    }
    if (!r) {
      if (equal(l, b)) continue; // deleted remotely
      conflicts.push(`${path}[${id}]`);
      out.set(id, l);
      continue;
    }
    const merged = merge3(b, l, r, `${path}[${id}]`);
    out.set(id, merged.value as Record<string, unknown>);
    conflicts.push(...merged.conflicts);
  }

  const localIds = local.map((item) => item.id as string);
  const remoteIds = remote.map((item) => item.id as string);
  const baseIds = base.map((item) => item.id as string);
  const localOrder = orderChanged(baseIds, localIds);
  const remoteOrder = orderChanged(baseIds, remoteIds);
  let order: string[];
  if (localOrder && remoteOrder && localIds.filter((id) => out.has(id)).join('|') !== remoteIds.filter((id) => out.has(id)).join('|')) {
    conflicts.push(`${path}.order`);
    order = localIds;
  } else {
    order = localOrder ? localIds : remoteIds;
  }
  const selected = order.filter((id) => out.has(id));
  for (const id of out.keys()) if (!selected.includes(id)) selected.push(id);
  return { value: selected.map((id) => out.get(id)!), conflicts };
}

export function merge3(base: unknown, local: unknown, remote: unknown, path = 'trip'): MergeResult {
  if (equal(local, remote)) return { value: local, conflicts: [] };
  if (equal(local, base)) return { value: remote, conflicts: [] };
  if (equal(remote, base)) return { value: local, conflicts: [] };

  if (keyedArray(base) && keyedArray(local) && keyedArray(remote)) {
    return mergeKeyedArray(base, local, remote, path);
  }
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const conflicts: string[] = [];
    const value: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const result = merge3(base[key], local[key], remote[key], `${path}.${key}`);
      if (result.value !== undefined) value[key] = result.value;
      conflicts.push(...result.conflicts);
    }
    return { value, conflicts };
  }

  // One side deleted or both sides changed the same scalar: keep local and surface conflict.
  return { value: local, conflicts: [path] };
}
