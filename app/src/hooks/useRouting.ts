import { useEffect, useRef, useState } from 'react';
import type { AvailableCityId, LegRoute, Stop } from '../data/types';
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

export function useRouting(city: AvailableCityId, stops: Stop[]) {
  const [legs, setLegs] = useState<LegRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (reply: WorkerReply) => void>());
  const tokenRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('../routing/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const resolve = pendingRef.current.get(event.data.id);
      if (resolve) {
        pendingRef.current.delete(event.data.id);
        resolve(event.data);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const token = ++tokenRef.current;
    if (stops.length < 2) {
      setLegs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const pairs = stops.slice(0, -1).map((from, i) => ({ from, to: stops[i + 1], mode: from.transportToNext }));
    const worker = workerRef.current;

    const run = async (from: Stop, to: Stop, mode: 'walk' | 'taxi') => {
      if (!worker) return fallback(from, to, mode);
      const id = ++requestCounter;
      const reply = await new Promise<WorkerReply>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(id);
          resolve({ id, ok: false, error: 'timeout' });
        }, 7000);
        pendingRef.current.set(id, (r) => {
          window.clearTimeout(timer);
          resolve(r);
        });
        worker.postMessage({ id, city, mode, from: [from.lon, from.lat], to: [to.lon, to.lat] });
      });
      if (!reply.ok || !reply.coordinates) return fallback(from, to, mode);
      return {
        fromStopId: from.id,
        toStopId: to.id,
        mode,
        distanceM: reply.distanceM ?? 0,
        durationMin: reply.durationMin ?? 0,
        coordinates: reply.coordinates,
        ok: true,
      } satisfies LegRoute;
    };

    Promise.all(pairs.map((p) => run(p.from, p.to, p.mode))).then((next) => {
      if (token !== tokenRef.current) return;
      setLegs(next);
      setLoading(false);
    }).catch(() => {
      if (token !== tokenRef.current) return;
      setLegs(pairs.map((p) => fallback(p.from, p.to, p.mode)));
      setLoading(false);
    });
  }, [city, stops]);

  return { legs, loading };
}
