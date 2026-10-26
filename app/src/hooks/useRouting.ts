import { useEffect, useRef, useState } from 'react';
import type { AvailableCityId, Day, LegRoute, Stop } from '../data/types';
import { haversine } from '../utils';

type WorkerReply = {
  id: number;
  ok: boolean;
  coordinates?: [number, number][];
  distanceM?: number;
  durationMin?: number;
  error?: string;
};

let requestCounter = 0;

function fallback(from: Stop, to: Stop, mode: 'walk' | 'taxi'): LegRoute {
  const distance = haversine(from.lon, from.lat, to.lon, to.lat) * 1.18;
  const speed = mode === 'walk' ? 4.6 : 25;
  return {
    fromStopId: from.id,
    toStopId: to.id,
    mode,
    distanceM: Math.round(distance),
    durationMin: Math.round(((distance / 1000) / speed) * 60 + (mode === 'taxi' ? 2 : 0)),
    coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
    ok: false,
  };
}

type DayPair = {
  dayId: string;
  city: AvailableCityId;
  from: Stop;
  to: Stop;
  mode: 'walk' | 'taxi';
};

export function useRouting(city: AvailableCityId, days: Day[], activeDayId: string, enabled = true) {
  const [routesByDay, setRoutesByDay] = useState<Record<string, LegRoute[]>>({});
  const [loading, setLoading] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (reply: WorkerReply) => void>());
  const tokenRef = useRef(0);
  const sentGraphs = useRef(new Set<string>());

  useEffect(() => {
    const worker = new Worker(new URL('../routing/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply | { type: string; key?: string }>) => {
      if ('type' in event.data) {
        if (event.data.type === 'worker-ready') setWorkerReady(true);
        return;
      }
      const resolve = pendingRef.current.get(event.data.id);
      if (resolve) {
        pendingRef.current.delete(event.data.id);
        resolve(event.data);
      }
    };
    worker.onerror = (event) => console.error('[yanlu] routing worker error', event.message);
    worker.onmessageerror = () => console.error('[yanlu] routing worker message error');
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
      setWorkerReady(false);
    };
  }, []);

  useEffect(() => {
    const token = ++tokenRef.current;
    if (!enabled) {
      setRoutesByDay({});
      setLoading(false);
      return;
    }
    if (!workerReady) {
      setLoading(true);
      return;
    }

    const pairs: DayPair[] = [];
    for (const day of days) {
      const dayCity = (day.cityId ?? city) as AvailableCityId;
      for (let i = 0; i < day.stops.length - 1; i += 1) {
        const from = day.stops[i];
        const to = day.stops[i + 1];
        pairs.push({ dayId: day.id, city: dayCity, from, to, mode: from.transportToNext });
      }
    }
    if (!pairs.length) {
      setRoutesByDay(Object.fromEntries(days.map((day) => [day.id, []])));
      setLoading(false);
      return;
    }

    setLoading(true);
    const cities = new Map<string, { city: AvailableCityId; mode: 'walk' | 'taxi' }>();
    for (const pair of pairs) cities.set(`${pair.city}-${pair.mode}`, { city: pair.city, mode: pair.mode });
    for (const { city: graphCity, mode } of cities.values()) {
      const key = `${graphCity}-${mode}`;
      if (sentGraphs.current.has(key)) continue;
      sentGraphs.current.add(key);
      workerRef.current?.postMessage({
        type: 'graph-ref',
        city: graphCity,
        mode,
        cacheName: `yanlu-pack-v2-${graphCity}`,
        url: `https://yanlu.local/packs/${graphCity}/${mode === 'walk' ? 'walk' : 'car'}.json`,
      });
    }

    const run = async (pair: DayPair): Promise<LegRoute> => {
      const worker = workerRef.current;
      if (!worker) return fallback(pair.from, pair.to, pair.mode);
      const id = ++requestCounter;
      const reply = await new Promise<WorkerReply>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(id);
          resolve({ id, ok: false, error: 'timeout' });
        }, 9000);
        pendingRef.current.set(id, (reply) => {
          window.clearTimeout(timer);
          resolve(reply);
        });
        worker.postMessage({
          id,
          city: pair.city,
          mode: pair.mode,
          from: [pair.from.lon, pair.from.lat],
          to: [pair.to.lon, pair.to.lat],
        });
      });
      if (!reply.ok || !reply.coordinates) {
        return fallback(pair.from, pair.to, pair.mode);
      }
      return {
        fromStopId: pair.from.id,
        toStopId: pair.to.id,
        mode: pair.mode,
        distanceM: reply.distanceM ?? 0,
        durationMin: reply.durationMin ?? 0,
        coordinates: reply.coordinates,
        ok: true,
      };
    };

    Promise.all(pairs.map(async (pair) => ({ pair, leg: await run(pair) })))
      .then((results) => {
        if (token !== tokenRef.current) return;
        const next: Record<string, LegRoute[]> = Object.fromEntries(days.map((day) => [day.id, []]));
        for (const { pair, leg } of results) next[pair.dayId].push(leg);
        setRoutesByDay(next);
        setLoading(false);
      })
      .catch(() => {
        if (token !== tokenRef.current) return;
        const next: Record<string, LegRoute[]> = Object.fromEntries(days.map((day) => [day.id, []]));
        for (const pair of pairs) next[pair.dayId].push(fallback(pair.from, pair.to, pair.mode));
        setRoutesByDay(next);
        setLoading(false);
      });
  }, [city, days, workerReady, enabled]);

  return {
    legs: routesByDay[activeDayId] ?? [],
    routesByDay,
    loading,
  };
}
