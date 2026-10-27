import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MapView from './components/MapView';
import { AddPlaceSheet, ConfirmSheet, LodgingSheet, MapPickSheet, PackSheet, StopSheet } from './components/Sheets';
import { useRouting } from './hooks/useRouting';
import { deleteCachedPack, downloadPackArchive, listCachedPacks } from './lib/packCache';
import { releaseTileUrls } from './lib/tileStore';
import { getPackBaseUrl, setPackBaseUrl } from './config';
import {
  availableCities, cityPlaces, formatBytes, makeStop, packs, provinceOf, seedTrip, themes,
} from './data/packs';
import type { AvailableCityId, CityId, Day, LegRoute, Lodging, Place, Stop, Theme, Transport, Trip } from './data/types';
import { fetchLanSnapshot, lanSupported, pingLan, probeLan, publishLanSnapshot, pushLanSnapshot, startLanHost, stopLanHost, type LanInfo } from './lib/lan';
import { dateLabel, formatDuration, formatKm, formatTime, parseTime } from './utils';

type Persisted = {
  activeCity: AvailableCityId;
  downloaded: CityId[];
  fineDownloaded: CityId[];
  trips: Record<AvailableCityId, Trip>;
};

const STORAGE_KEY = 'yanlu.m2.v1';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDay(day: Day, index: number, city: AvailableCityId): Day {
  return {
    id: day.id || `day-${city}-${index + 1}`,
    date: day.date || new Date().toISOString().slice(0, 10),
    label: day.label || `DAY ${String(index + 1).padStart(2, '0')}`,
    title: day.title || `第 ${index + 1} 天`,
    cityId: day.cityId && availableCities.includes(day.cityId) ? day.cityId : city,
    startTime: day.startTime || '09:30',
    earliestStart: day.earliestStart,
    latestEnd: day.latestEnd,
    stops: Array.isArray(day.stops) ? day.stops : [],
    lodging: day.lodging,
  };
}

function normalizeTrip(raw: Trip | undefined, city: AvailableCityId): Trip {
  const fallback = seedTrip(city);
  if (!raw) return fallback;
  const legacy = raw as Trip & { day?: Day };
  const rawDays = Array.isArray(raw.days) ? raw.days : legacy.day ? [legacy.day] : [];
  const days = rawDays.length ? rawDays.map((day, i) => normalizeDay(day, i, city)) : fallback.days;
  const activeDayId = days.some((day) => day.id === raw.activeDayId) ? raw.activeDayId : days[0].id;
  const startDate = raw.startDate || days[0].date || new Date().toISOString().slice(0, 10);
  return {
    id: raw.id || fallback.id,
    cityId: city,
    title: raw.title || fallback.title,
    startDate,
    days: days.map((day, i) => ({ ...day, date: addDays(startDate, i) })),
    activeDayId,
  };
}

function initialPersisted(): Persisted {
  const trips = {} as Record<AvailableCityId, Trip>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Persisted>;
      for (const city of availableCities) {
        const savedTrip = saved.trips?.[city];
        trips[city] = normalizeTrip(savedTrip, city);
      }
      const savedDownloaded = Array.isArray(saved.downloaded)
        ? saved.downloaded.filter((id): id is CityId => availableCities.includes(id as AvailableCityId))
        : [];
      const savedFine = Array.isArray(saved.fineDownloaded)
        ? saved.fineDownloaded.filter((id): id is CityId => availableCities.includes(id as AvailableCityId))
        : [];
      const active = saved.activeCity && savedDownloaded.includes(saved.activeCity)
        ? saved.activeCity as AvailableCityId
        : (savedDownloaded[0] as AvailableCityId | undefined) ?? 'chongqing';
      // Render from the last known state immediately; cache validation runs in the background.
      return { activeCity: active, downloaded: savedDownloaded, fineDownloaded: savedFine, trips };
    }
  } catch {
    // fall through to seed
  }
  for (const city of availableCities) trips[city] = seedTrip(city);
  return { activeCity: 'chongqing', downloaded: [], fineDownloaded: [], trips };
}

function themeVars(theme: Theme): CSSProperties {
  return {
    '--paper': theme.paper,
    '--paper-deep': theme.paperDeep,
    '--ink': theme.ink,
    '--muted': theme.muted,
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--water': theme.water,
    '--land': theme.land,
    '--green': theme.green,
    '--road': theme.road,
    '--line': theme.line,
    '--hero-a': theme.heroA,
    '--hero-b': theme.heroB,
  } as CSSProperties;
}

function App() {
  const [state, setState] = useState<Persisted>(initialPersisted);
  const [previewCity, setPreviewCity] = useState<CityId | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [mapPick, setMapPick] = useState<{ lon: number; lat: number } | null>(null);
  const [stopOpenId, setStopOpenId] = useState<string | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<CityId, number>>>({});
  const [packError, setPackError] = useState<string | null>(null);
  const [deleteConfirmCity, setDeleteConfirmCity] = useState<AvailableCityId | null>(null);
  const [booted, setBooted] = useState(true);
  const [packBase, setPackBase] = useState(getPackBaseUrl);
  const [fineProgress, setFineProgress] = useState<Partial<Record<CityId, number>>>({});
  const [deleteFineCity, setDeleteFineCity] = useState<AvailableCityId | null>(null);
  const [deleteDayId, setDeleteDayId] = useState<string | null>(null);
  const [lodgingOpen, setLodgingOpen] = useState(false);
  const [page, setPage] = useState<'overview' | 'day' | 'people'>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [mapMounted, setMapMounted] = useState(false);
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);
  const [lanGuest, setLanGuest] = useState({ ip: '', port: '8766', room: '' });
  const [lanStatus, setLanStatus] = useState('');
  const [lanBusy, setLanBusy] = useState(false);
  const [lanRole, setLanRole] = useState<'host' | 'guest' | null>(null);
  const [lanMembers, setLanMembers] = useState<string[]>([]);
  const lanVersionRef = useRef(0);
  const lanJsonRef = useRef('');
  const lanApplyingRef = useRef(false);
  const lanDeviceIdRef = useRef('');
  if (!lanDeviceIdRef.current) {
    const key = 'yanlu.lan.device';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    lanDeviceIdRef.current = id;
  }
  const lanInfoRef = useRef<LanInfo | null>(null);
  const tripRef = useRef<Trip | null>(null);
  const [focusFine, setFocusFine] = useState(0);

  const activeCity = state.activeCity;
  const trip = state.trips[activeCity];
  lanInfoRef.current = lanInfo;
  tripRef.current = trip;
  const activeDay = trip.days.find((day) => day.id === trip.activeDayId) ?? trip.days[0];
  const activeDayIndex = trip.days.findIndex((day) => day.id === activeDay.id);
  const dayCity = activeDay.cityId && state.downloaded.includes(activeDay.cityId) ? activeDay.cityId : activeCity;
  const stops = activeDay.stops;
  const pack = packs[dayCity];
  const province = provinceOf(dayCity);
  const baseTheme = themes[dayCity];
  const previewTheme = previewCity ? themes[previewCity] : baseTheme;
  const pageTheme = packOpen ? previewTheme : baseTheme;

  const { legs, routesByDay, loading } = useRouting(dayCity, trip.days, activeDay.id, state.downloaded.includes(dayCity));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [page]);

  useEffect(() => {
    if (page === 'day') setMapMounted(true);
  }, [page]);

  // Warm the day map after the overview has settled, without blocking first paint.
  useEffect(() => {
    if (mapMounted || page !== 'overview' || !state.downloaded.length) return;
    const timer = window.setTimeout(() => setMapMounted(true), 800);
    return () => window.clearTimeout(timer);
  }, [mapMounted, page, state.downloaded.length]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCachedPacks('standard'), listCachedPacks('fine')])
      .then(([keys, fineKeys]) => {
        if (cancelled) return;
        const downloaded = keys.filter((id): id is AvailableCityId => availableCities.includes(id as AvailableCityId));
        const fineDownloaded = fineKeys.filter((id): id is AvailableCityId => availableCities.includes(id as AvailableCityId) && downloaded.includes(id as AvailableCityId));
        setState((prev) => {
          const active = downloaded.includes(prev.activeCity) ? prev.activeCity : (downloaded[0] ?? 'chongqing');
          return { ...prev, downloaded, fineDownloaded, activeCity: active };
        });
        if (!downloaded.length) setPackOpen(true);
      })
      .catch(() => setPackOpen(true))
      .finally(() => setBooted(true));
    return () => { cancelled = true; };
  }, []);

  const timeline = useMemo(() => {
    let cursor = parseTime(activeDay.earliestStart || activeDay.startTime);
    return stops.map((stop, i) => {
      const t = stop.transportInfo;
      const depart = t?.departTime ? parseTime(t.departTime) : null;
      const fixed = stop.fixedTime ? parseTime(stop.fixedTime) : null;
      const station = depart !== null ? depart - (t?.preArriveMin ?? 30) : fixed;
      const arrive = station !== null ? Math.max(cursor, station) : cursor;
      let leave = arrive + stop.durationMin;
      if (t?.arriveTime) {
        const raw = parseTime(t.arriveTime);
        const at = depart !== null && raw < depart ? raw + 1440 : raw;
        leave = Math.max(arrive, at);
      }
      const leg = legs[i];
      cursor = leave + (leg?.durationMin ?? 0);
      return { stop, arrive, leave, leg };
    });
  }, [stops, legs, activeDay.startTime]);

  const totalMeters = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const totalMinutes = timeline.length
    ? timeline[timeline.length - 1].leave - parseTime(activeDay.earliestStart || activeDay.startTime)
    : 0;
  const tripMeters = Object.values(routesByDay).flat().reduce((sum, leg) => sum + leg.distanceM, 0);
  const tripRouteMinutes = Object.values(routesByDay).flat().reduce((sum, leg) => sum + leg.durationMin, 0);
  const latestEnd = activeDay.latestEnd ? parseTime(activeDay.latestEnd) : null;
  const lastLeave = timeline.length ? timeline[timeline.length - 1].leave : 0;
  const overrun = latestEnd !== null && lastLeave > latestEnd ? lastLeave - latestEnd : 0;
  const totalStops = trip.days.reduce((sum, day) => sum + day.stops.length, 0);
  const totalStayMinutes = trip.days.reduce(
    (sum, day) => sum + day.stops.reduce((daySum, stop) => daySum + stop.durationMin, 0),
    0,
  );

  const updateStops = (next: Stop[] | ((current: Stop[]) => Stop[])) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      const dayId = currentTrip.activeDayId;
      const currentDay = currentTrip.days.find((day) => day.id === dayId) ?? currentTrip.days[0];
      const nextStops = typeof next === 'function' ? next(currentDay.stops) : next;
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentDay.id ? { ...day, stops: nextStops } : day)),
          },
        },
      };
    });
  };

  const setStartTime = (startTime: string) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentTrip.activeDayId ? { ...day, startTime } : day)),
          },
        },
      };
    });
  };

  const switchDay = (dayId: string) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      if (!currentTrip.days.some((day) => day.id === dayId)) return prev;
      return {
        ...prev,
        trips: { ...prev.trips, [prev.activeCity]: { ...currentTrip, activeDayId: dayId } },
      };
    });
    setActiveStopId(null);
    setStopOpenId(null);
  };

  const setStartDate = (startDate: string) => {
    if (!startDate) return;
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            startDate,
            days: currentTrip.days.map((day, i) => ({ ...day, date: addDays(startDate, i) })),
          },
        },
      };
    });
  };

  const setDayWindow = (patch: { earliestStart?: string; latestEnd?: string }) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentTrip.activeDayId ? { ...day, ...patch } : day)),
          },
        },
      };
    });
  };

  const updateDayTitle = (title: string) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentTrip.activeDayId ? { ...day, title } : day)),
          },
        },
      };
    });
  };

  const updateLodging = (lodging: Lodging | undefined) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentTrip.activeDayId ? { ...day, lodging } : day)),
          },
        },
      };
    });
    setLodgingOpen(false);
  };

  const updateDayCity = (city: AvailableCityId) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === currentTrip.activeDayId ? { ...day, cityId: city } : day)),
          },
        },
      };
    });
    setActiveStopId(null);
    setStopOpenId(null);
  };

  const addDay = () => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      const last = currentTrip.days[currentTrip.days.length - 1];
      const index = currentTrip.days.length + 1;
      const day: Day = {
        id: `day-${prev.activeCity}-${index}-${Date.now()}`,
        date: addDays(currentTrip.startDate, currentTrip.days.length),
        label: `DAY ${String(index).padStart(2, '0')}`,
        title: `第 ${index} 天`,
        cityId: currentTrip.days[currentTrip.days.length - 1].cityId ?? prev.activeCity,
        startTime: last.startTime,
        earliestStart: last.earliestStart,
        latestEnd: last.latestEnd,
        stops: [],
      };
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: [...currentTrip.days, day],
            activeDayId: day.id,
          },
        },
      };
    });
    setActiveStopId(null);
    setStopOpenId(null);
    setPage('day');
  };

  const copyPreviousDay = () => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      const index = currentTrip.days.findIndex((day) => day.id === currentTrip.activeDayId);
      if (index <= 0) return prev;
      const source = currentTrip.days[index - 1];
      const target = currentTrip.days[index];
      const existing = new Set(target.stops.map((stop) => stop.placeId));
      const copies = source.stops
        .filter((stop) => !existing.has(stop.placeId))
        .map((stop, i) => ({ ...stop, id: `${stop.id}-copy-${Date.now()}-${i}` }));
      if (!copies.length) return prev;
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === target.id
              ? { ...day, cityId: source.cityId ?? day.cityId, stops: [...day.stops, ...copies] }
              : day)),
          },
        },
      };
    });
  };

  const copyStopToDay = (stopId: string, targetDayId: string) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      const source = currentTrip.days.find((day) => day.id === currentTrip.activeDayId);
      const target = currentTrip.days.find((day) => day.id === targetDayId);
      const stop = source?.stops.find((item) => item.id === stopId);
      if (!stop || !target || target.stops.some((item) => item.placeId === stop.placeId)) return prev;
      const copy: Stop = { ...stop, id: `${stop.id}-copy-${Date.now()}` };
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: {
            ...currentTrip,
            days: currentTrip.days.map((day) => (day.id === target.id
              ? { ...day, stops: [...day.stops, copy] }
              : day)),
          },
        },
      };
    });
    setStopOpenId(null);
  };

  const requestDeleteDay = (dayId: string) => {
    const current = state.trips[activeCity];
    if (current.days.length <= 1) return;
    setDeleteDayId(dayId);
  };

  const confirmDeleteDay = () => {
    const dayId = deleteDayId;
    if (!dayId) return;
    setDeleteDayId(null);
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      if (currentTrip.days.length <= 1) return prev;
      const index = currentTrip.days.findIndex((day) => day.id === dayId);
      if (index < 0) return prev;
      const days = currentTrip.days.filter((day) => day.id !== dayId);
      const activeDayId = currentTrip.activeDayId === dayId
        ? days[Math.max(0, index - 1)].id
        : currentTrip.activeDayId;
      return {
        ...prev,
        trips: { ...prev.trips, [prev.activeCity]: { ...currentTrip, days, activeDayId } },
      };
    });
    setActiveStopId(null);
    setStopOpenId(null);
  };

  const updateStop = (id: string, patch: Partial<Stop>) => {
    updateStops((current) => current.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));
  };

  const addPlace = (place: Place) => {
    updateStops((current) => {
      if (current.some((s) => s.placeId === place.id)) return current;
      return [...current, makeStop(place)];
    });
    setAddOpen(false);
  };

  const deleteStop = (id: string) => {
    updateStops((current) => current.filter((stop) => stop.id !== id));
    setStopOpenId(null);
    setActiveStopId(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateStops((current) => {
      const oldIndex = current.findIndex((s) => s.id === active.id);
      const newIndex = current.findIndex((s) => s.id === over.id);
      return arrayMove(current, oldIndex, newIndex);
    });
    setActiveStopId(null);
  };

  const selectCity = (city: AvailableCityId) => {
    setState((prev) => ({ ...prev, activeCity: city }));
    setPreviewCity(null);
    setPackOpen(false);
    setActiveStopId(null);
  };

  const downloadPack = async (city: AvailableCityId) => {
    if (!packs[city].available) return;
    setPackError(null);
    setProgress((prev) => ({ ...prev, [city]: 1 }));
    try {
      await downloadPackArchive(city, (pct) => setProgress((prev) => ({ ...prev, [city]: pct })));
      setState((prev) => {
        const downloaded = prev.downloaded.includes(city) ? prev.downloaded : [...prev.downloaded, city];
        const active = prev.downloaded.length === 0 ? city : prev.activeCity;
        return {
          ...prev,
          downloaded,
          activeCity: active,
          trips: prev.trips[city] ? prev.trips : { ...prev.trips, [city]: seedTrip(city) },
        };
      });
      setPreviewCity(city);
      window.setTimeout(() => setProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      }), 900);
    } catch (err) {
      setPackError(`下载失败：${err instanceof Error ? err.message : String(err)}`);
      setProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      });
    }
  };

  const downloadFine = async (city: AvailableCityId) => {
    if (!packs[city].fine?.available) return;
    setPackError(null);
    setFineProgress((prev) => ({ ...prev, [city]: 1 }));
    try {
      await downloadPackArchive(city, (pct) => setFineProgress((prev) => ({ ...prev, [city]: pct })), 'fine');
      setState((prev) => ({
        ...prev,
        fineDownloaded: prev.fineDownloaded.includes(city) ? prev.fineDownloaded : [...prev.fineDownloaded, city],
      }));
      window.setTimeout(() => setFineProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      }), 900);
    } catch (err) {
      setPackError(`精细底图下载失败：${err instanceof Error ? err.message : String(err)}`);
      setFineProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      });
    }
  };

  const requestDeleteFine = (city: AvailableCityId) => {
    setDeleteFineCity(city);
  };

  const showFine = (city: AvailableCityId) => {
    setState((prev) => ({ ...prev, activeCity: city }));
    setPackOpen(false);
    setPreviewCity(null);
    setFocusFine((n) => n + 1);
  };

  const confirmDeleteFine = async () => {
    const city = deleteFineCity;
    if (!city) return;
    setDeleteFineCity(null);
    await deleteCachedPack(city, 'fine');
    releaseTileUrls(city, 'fine');
    setState((prev) => ({ ...prev, fineDownloaded: prev.fineDownloaded.filter((id) => id !== city) }));
  };

  const requestDelete = (city: AvailableCityId) => {
    if (state.downloaded.length <= 1) { setPackError('至少保留一个城市地图包。'); return; }
    setDeleteConfirmCity(city);
  };

  const confirmDelete = async () => {
    const city = deleteConfirmCity;
    if (!city) return;
    setDeleteConfirmCity(null);
    await deleteCachedPack(city);
    await deleteCachedPack(city, 'fine');
    releaseTileUrls(city);
    releaseTileUrls(city, 'fine');
    setState((prev) => {
      const downloaded = prev.downloaded.filter((id) => id !== city);
      const active = prev.activeCity === city
        ? (downloaded.find((id): id is AvailableCityId => availableCities.includes(id as AvailableCityId)) ?? 'chongqing')
        : prev.activeCity;
      return { ...prev, downloaded, fineDownloaded: prev.fineDownloaded.filter((id) => id !== city), activeCity: active };
    });
    setPreviewCity(null);
  };

  const openDay = (dayId: string) => {
    switchDay(dayId);
    setPage('day');
  };

  const copySummary = async () => {
    const lines = [
      `沿路 · ${pack.city}`,
      `${trip.startDate} 起 · ${trip.days.length} 天`,
      ...trip.days.map((day, i) => `${day.label} ${day.date} ${day.title || `第 ${i + 1} 天`}：${day.stops.map((stop) => stop.name).join(' → ') || '未安排'}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setNotice('行程摘要已复制');
    } catch {
      setNotice('当前环境不支持复制，请稍后再试');
    }
  };

  const exportTrip = () => {
    try {
      const blob = new Blob([JSON.stringify({ trip, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yanlu-${pack.city}-${trip.startDate}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('行程备份已导出');
    } catch {
      setNotice('当前环境不支持导出');
    }
  };

  const applyRemoteTrip = (raw: Trip) => {
    if (!raw || !Array.isArray(raw.days) || !raw.days.length) return;
    const city = availableCities.includes(raw.cityId) ? raw.cityId : activeCity;
    const next = normalizeTrip(raw, city);
    lanApplyingRef.current = true;
    lanJsonRef.current = JSON.stringify(next);
    setState((prev) => ({
      ...prev,
      activeCity: city,
      trips: { ...prev.trips, [city]: next },
    }));
    setNotice('已接收同行设备的行程');
    window.setTimeout(() => { lanApplyingRef.current = false; }, 60);
  };

  const startRoom = async () => {
    if (!lanSupported()) { setLanStatus('局域网功能只在 Android App 内可用'); return; }
    setLanBusy(true);
    try {
      const info = startLanHost();
      if (!info.ok) throw new Error(info.error ?? '启动失败');
      setLanInfo(info);
      setLanRole('host');
      setLanMembers([]);
      lanVersionRef.current = 0;
      lanJsonRef.current = '';
      setLanStatus(`房间 ${info.room} 已开启`);
    } catch (err) {
      setLanStatus(`开启失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLanBusy(false);
    }
  };

  const closeRoom = () => {
    if (lanSupported()) stopLanHost();
    setLanInfo(null);
    setLanRole(null);
    setLanMembers([]);
    lanVersionRef.current = 0;
    lanJsonRef.current = '';
    setLanStatus('房间已关闭');
  };

  const publishHost = () => {
    if (!lanInfo) return;
    try {
      const result = publishLanSnapshot(lanInfo, trip);
      if (!result.ok) throw new Error(result.error ?? '发布失败');
      const v = result.version ?? lanInfo.version;
      lanVersionRef.current = v;
      lanJsonRef.current = JSON.stringify(trip);
      setLanInfo({ ...lanInfo, version: v });
      setLanStatus(`已发布当前行程 · v${v}`);
    } catch (err) {
      setLanStatus(`发布失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const pullHost = async () => {
    if (!lanInfo) return;
    setLanBusy(true);
    try {
      const snap = await fetchLanSnapshot(lanInfo);
      if (snap.trip) applyRemoteTrip(snap.trip as Trip);
      setLanInfo({ ...lanInfo, version: snap.version });
      setLanStatus(`已拉取 v${snap.version}`);
    } catch (err) {
      setLanStatus(`拉取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLanBusy(false);
    }
  };

  const joinRoom = async () => {
    const ip = lanGuest.ip.trim();
    const room = lanGuest.room.trim();
    const port = Number(lanGuest.port) || 8766;
    if (!ip || !room) { setLanStatus('请填写房主 IP 和房间码'); return; }
    setLanBusy(true);
    try {
      const info = await probeLan({ ip, port });
      if (info.room !== room) throw new Error('房间码不匹配');
      const snap = await fetchLanSnapshot({ ip, port, room });
      if (snap.trip) applyRemoteTrip(snap.trip as Trip);
      setLanInfo({ ip, port, room, version: snap.version });
      setLanRole('guest');
      setLanMembers([]);
      lanVersionRef.current = snap.version;
      lanJsonRef.current = snap.trip ? JSON.stringify(snap.trip) : '';
      setLanStatus(`已加入房间 ${room} · v${snap.version}`);
    } catch (err) {
      setLanStatus(`加入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLanBusy(false);
    }
  };

  const pushGuest = async () => {
    if (!lanInfo) return;
    setLanBusy(true);
    try {
      const result = await pushLanSnapshot(lanInfo, trip);
      const v = result.version ?? lanInfo.version;
      lanVersionRef.current = v;
      lanJsonRef.current = JSON.stringify(trip);
      setLanInfo({ ...lanInfo, version: v });
      setLanStatus(`已推送本机行程 · v${v}`);
    } catch (err) {
      setLanStatus(`推送失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLanBusy(false);
    }
  };

  // Host and guest both keep the room snapshot warm. The host publishes local
  // edits; a guest publishes its local edits too. Version guards stop echoes.
  useEffect(() => {
    if (!lanInfo || !lanRole) return;
    const json = JSON.stringify(trip);
    if (json === lanJsonRef.current) return;
    const timer = window.setTimeout(async () => {
      const info = lanInfoRef.current;
      if (!info) return;
      try {
        const result = lanRole === 'host'
          ? publishLanSnapshot(info, tripRef.current)
          : await pushLanSnapshot(info, tripRef.current);
        const v = result.version ?? info.version;
        lanVersionRef.current = v;
        lanJsonRef.current = json;
        setLanInfo((prev) => (prev ? { ...prev, version: v } : prev));
        setLanStatus(`自动同步 · v${v}`);
      } catch {
        // The room may have been closed; manual controls still expose details.
      }
    }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, lanInfo?.room, lanInfo?.ip, lanInfo?.port, lanRole]);

  useEffect(() => {
    if (!lanInfo || !lanRole) return;
    let cancelled = false;
    const tick = async () => {
      const info = lanInfoRef.current;
      if (!info || cancelled) return;
      try {
        const snap = await fetchLanSnapshot(info);
        if (cancelled || snap.version <= lanVersionRef.current || !snap.trip) return;
        lanVersionRef.current = snap.version;
        const remoteJson = JSON.stringify(snap.trip);
        if (remoteJson !== JSON.stringify(tripRef.current)) {
          applyRemoteTrip(snap.trip as Trip);
        }
        lanJsonRef.current = remoteJson;
        setLanInfo((prev) => (prev ? { ...prev, version: snap.version } : prev));
        setLanStatus(`已自动同步 · v${snap.version}`);
      } catch {
        // Poll again; no modal errors while the Wi-Fi is briefly unavailable.
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanInfo?.room, lanInfo?.ip, lanInfo?.port, lanRole]);

  useEffect(() => {
    if (!lanInfo || !lanRole) return;
    let cancelled = false;
    const name = lanRole === 'host' ? '房主' : '同行者';
    const tick = async () => {
      const info = lanInfoRef.current;
      if (!info || cancelled) return;
      try {
        const result = await pingLan(info, lanDeviceIdRef.current, name);
        if (!cancelled) setLanMembers(result.members);
      } catch {
        // presence is best-effort
      }
    };
    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanInfo?.room, lanInfo?.ip, lanInfo?.port, lanRole]);

  const selectedStop = stopOpenId ? stops.find((s) => s.id === stopOpenId) ?? null : null;
  const selectedIndex = selectedStop ? stops.findIndex((s) => s.id === selectedStop.id) : -1;
  const titleParts = pack.title.split('，');
  const packSheet = packOpen ? (
    <PackSheet
      activeCity={dayCity}
      downloaded={state.downloaded}
      previewCity={previewCity}
      progress={progress}
      error={packError}
      onClose={() => { setPackOpen(false); setPreviewCity(null); setPackError(null); }}
      onPreview={setPreviewCity}
      onSelect={selectCity}
      onDownload={downloadPack}
      onDelete={requestDelete}
      fineDownloaded={state.fineDownloaded}
      fineProgress={fineProgress}
      onDownloadFine={downloadFine}
      onDeleteFine={requestDeleteFine}
      onShowFine={showFine}
      packBase={packBase}
      onPackBaseChange={(value) => { setPackBase(value); setPackBaseUrl(value); }}
    />
  ) : null;

  if (!booted) {
    return <div className="boot-screen" style={themeVars(pageTheme)}><span>正在读取本机地图包…</span></div>;
  }

  if (!state.downloaded.length) {
    return (
      <div className="app onboarding" style={themeVars(pageTheme)}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M5 17c0-4.6 6.4-3.4 6.4-8S18 5.8 19 10" />
                <circle cx="5" cy="17" r="1.7" fill="currentColor" stroke="none" />
                <circle cx="19" cy="10" r="1.7" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span><b>沿路</b><small>YANLU</small></span>
          </div>
        </header>
        <main className="first-run">
          <span className="eyebrow">START HERE · OFFLINE FIRST</span>
          <h1>先下载<br /><em>一座城市</em></h1>
          <p>每座城市是一个独立的离线包。下载后，地图、路网和算路都保存在这台设备上，断网也能继续编辑。</p>
          <button className="primary first-run-cta" onClick={() => setPackOpen(true)}>选择城市地图包 →</button>
          <div className="first-run-note">真实归档下载 · 本机缓存 · 可随时删除</div>
        </main>
        {packSheet}
      </div>
    );
  }

  const header = (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M5 17c0-4.6 6.4-3.4 6.4-8S18 5.8 19 10" />
            <circle cx="5" cy="17" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="19" cy="10" r="1.7" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span><b>沿路</b><small>YANLU</small></span>
      </div>
      <button className="city-pill" onClick={() => { setPackOpen(true); setPreviewCity(dayCity); }}>
        <span className="city-seal">{pack.short}</span>
        <span className="city-pill-text"><strong>{province.name === pack.city ? pack.city : `${province.name} · ${pack.city}`}</strong><small>{state.downloaded.includes(dayCity) ? '离线包已就绪' : '下载地图包'}</small></span>
        <span className="chev">⌄</span>
      </button>
    </header>
  );

  const startRow = (withCopy: boolean) => (
    <div className="trip-start-row">
      <label className="trip-start">行程出发日期<input type="date" value={trip.startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
      <span>{trip.days.length} 天 · 每天独立路线</span>
      <label className="day-city-select">城市<select value={dayCity} onChange={(e) => updateDayCity(e.target.value as AvailableCityId)}>
        {state.downloaded.map((city) => <option key={city} value={city}>{packs[city].city}</option>)}
      </select></label>
      {withCopy && activeDayIndex > 0 && <button className="text-btn day-copy" onClick={copyPreviousDay}>复制前一天</button>}
    </div>
  );

  const tripOverview = (
    <section className="trip-overview" aria-label="多日总览">
      <div><strong>{trip.days.length}</strong><span>天</span></div>
      <div><strong>{totalStops}</strong><span>个地点</span></div>
      <div><strong>{totalStayMinutes ? formatDuration(totalStayMinutes) : '—'}</strong><span>总停留</span></div>
      <div><strong>{tripMeters ? formatKm(tripMeters) : '—'}</strong><span>全行程</span></div>
    </section>
  );

  const dayTabs = (
    <section className="day-tabs" aria-label="行程日期">
      {trip.days.map((day, index) => (
        <button
          key={day.id}
          className={`day-tab${day.id === activeDay.id ? ' active' : ''}`}
          onClick={() => switchDay(day.id)}
        >
          <strong>{day.label}</strong>
          <small>{dateLabel(day.date)}</small>
          <span>{day.stops.length} 站</span>
          {index === trip.days.length - 1 && trip.days.length > 1 && (
            <i
              className="day-tab-delete"
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); requestDeleteDay(day.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); requestDeleteDay(day.id); } }}
              aria-label={`删除 ${day.label}`}
            >×</i>
          )}
        </button>
      ))}
      <button className="day-tab day-tab-add" onClick={addDay}>
        <strong>＋</strong>
        <small>加一天</small>
      </button>
    </section>
  );

  const daySection = (
    <section className="day-section">
      <div className="section-head">
        <div>
          <span className="eyebrow">YOUR DAY · {activeDay.label}</span>
          <input
            className="day-title-input"
            value={activeDay.title ?? `第 ${activeDayIndex + 1} 天`}
            onChange={(e) => updateDayTitle(e.target.value)}
            aria-label="当天标题"
          />
        </div>
        <label className="time-picker">出发<input type="time" value={activeDay.startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
      </div>

      <div className="day-window">
        <label>最早出发<input type="time" value={activeDay.earliestStart ?? ''} onChange={(e) => setDayWindow({ earliestStart: e.target.value || undefined })} /></label>
        <label>最晚结束<input type="time" value={activeDay.latestEnd ?? ''} onChange={(e) => setDayWindow({ latestEnd: e.target.value || undefined })} /></label>
        {overrun > 0 && <span className="time-warning">超出最晚时间 {formatDuration(overrun)}</span>}
      </div>

      <button className="lodging-card" onClick={() => setLodgingOpen(true)}>
        {activeDay.lodging ? (
          <>
            <strong>住宿 · {activeDay.lodging.name}</strong>
            <span>入住 {activeDay.lodging.checkIn} · 退房 {activeDay.lodging.checkOut}{activeDay.lodging.nights ? ` · ${activeDay.lodging.nights} 晚` : ''}</span>
            {activeDay.lodging.address && <span>{activeDay.lodging.address}</span>}
            {activeDay.lodging.booking && <span>订单 · {activeDay.lodging.booking}</span>}
            {activeDay.lodging.note && <span>{activeDay.lodging.note}</span>}
            <small>点击修改</small>
          </>
        ) : (
          <>
            <strong>＋ 添加住宿</strong>
            <span>记录酒店、入住/退房时间，不参与步行算路</span>
          </>
        )}
      </button>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="timeline">
            {timeline.map(({ stop, arrive, leave, leg }, index) => (
              <div className="timeline-item" key={stop.id}>
                <StopRow
                  stop={stop}
                  index={index}
                  arrive={arrive}
                  leave={leave}
                  leg={leg}
                  active={activeStopId === stop.id}
                  onOpen={() => { setActiveStopId(stop.id); setStopOpenId(stop.id); }}
                  onToggleTransport={() => updateStop(stop.id, { transportToNext: stop.transportToNext === 'walk' ? 'taxi' : 'walk' })}
                />
                {index < timeline.length - 1 && (
                  <div className="leg-row">
                    <span className="leg-line" />
                    <button className={`leg-pill ${leg?.mode ?? stop.transportToNext}`} onClick={() => updateStop(stop.id, { transportToNext: stop.transportToNext === 'walk' ? 'taxi' : 'walk' })}>
                      <span>{leg?.mode === 'taxi' ? '打车' : '步行'}</span>
                      <span>{leg ? `${formatKm(leg.distanceM)} · ${Math.round(leg.durationMin)} 分钟` : '计算中…'}</span>
                      <span className="swap">⇄</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!stops.length && <div className="empty-state">这一天还没有地点。加一个开始吧。</div>}

      <button className="add-stop" onClick={() => setAddOpen(true)}><span>＋</span> 添加地点</button>
      <p className="day-note">拖动地点右侧的手柄调整顺序；路线和时间会自动重算，并保存在本机。</p>
    </section>
  );

  return (
    <div className={`app page-${page}`} style={themeVars(pageTheme)} data-city={dayCity} data-page={page}>
      {header}

      {page === 'overview' && (
        <main className="overview-page">
          <section className="hero overview-hero">
            <div className="hero-orbit" aria-hidden="true" />
            <div className="hero-content">
              <div className="hero-kicker"><span>{province.name} · {pack.version}</span><span>{dateLabel(trip.startDate)} — {dateLabel(trip.days[trip.days.length - 1].date)}</span></div>
              <h1>{titleParts[0]}{titleParts[1] && <><br /><em>{titleParts[1]}</em></>}</h1>
              <p>{pack.tagline}</p>
              <div className="hero-stats">
                <div><strong>{trip.days.length}</strong><span>天</span></div>
                <div><strong>{totalStops}</strong><span>个地点</span></div>
                <div><strong>{totalStayMinutes ? formatDuration(totalStayMinutes) : '—'}</strong><span>总停留</span></div>
              </div>
            </div>
            <span className="hero-seal" aria-hidden="true">{pack.short}</span>
          </section>

          {startRow(false)}
          {tripOverview}

          <section className="overview-days">
            <div className="section-head">
              <div>
                <span className="eyebrow">YOUR ITINERARY</span>
                <h2>按天安排</h2>
              </div>
              <span className="overview-count">{trip.days.length} 天 · {totalStops} 个地点</span>
            </div>
            <div className="overview-day-list">
              {trip.days.map((day, index) => {
                const city = packs[day.cityId ?? activeCity].city;
                const stay = day.stops.reduce((sum, stop) => sum + stop.durationMin, 0);
                return (
                  <button
                    key={day.id}
                    className={`overview-day-card${day.id === activeDay.id ? ' current' : ''}`}
                    onClick={() => openDay(day.id)}
                  >
                    <div className="overview-day-date">
                      <strong>{day.label}</strong>
                      <span>{dateLabel(day.date)}</span>
                    </div>
                    <div className="overview-day-main">
                      <h3>{day.title || `第 ${index + 1} 天`}</h3>
                      <p>{day.stops.length} 个地点 · {stay ? formatDuration(stay) : '未安排'} · {city}{routesByDay[day.id]?.length ? ` · ${formatKm(routesByDay[day.id].reduce((sum, leg) => sum + leg.distanceM, 0))}` : ''}</p>
                      {day.stops.length > 0 && <small>{day.stops.map((stop) => stop.name).slice(0, 3).join(' · ')}{day.stops.length > 3 ? ' …' : ''}</small>}
                      {day.lodging && <small>住宿 · {day.lodging.name}</small>}
                    </div>
                    <span className="overview-day-arrow">↗</span>
                  </button>
                );
              })}
              <button className="overview-day-add" onClick={addDay}>＋ 再加一天</button>
            </div>
          </section>

          <footer className="app-footer">
            <span>本地地图 · 本地路网 · 无外部请求</span>
            <span>{pack.city} · {pack.version}</span>
          </footer>
        </main>
      )}

      {mapMounted && (
        <main className={`day-page page-view${page === 'day' ? '' : ' is-hidden'}`} aria-hidden={page !== 'day'}>
          <div className="day-page-head">
            <button className="page-back" onClick={() => setPage('overview')}>← 行程总览</button>
            <span>{activeDay.label} · {dateLabel(activeDay.date)}</span>
          </div>

          <section className="map-card day-map-card">
            <MapView
              city={dayCity}
              fine={state.fineDownloaded.includes(dayCity)}
              focusFine={focusFine}
              theme={baseTheme}
              stops={stops}
              legs={legs}
              activeStopId={activeStopId}
              onSelectStop={(id) => { setActiveStopId(id); setStopOpenId(id); }}
              onMapPick={setMapPick}
              active={page === 'day'}
            />
            <div className="map-badge">{loading ? '正在重算路线…' : totalMeters ? `${formatKm(totalMeters)} · ${legs.length} 段` : '还没有路线'}</div>
          </section>

          {startRow(true)}
          {dayTabs}
          {daySection}

          <footer className="app-footer">
            <span>本地地图 · 本地路网 · 无外部请求</span>
            <span>{pack.city} · {pack.version}</span>
          </footer>
        </main>
      )}

      {page === 'people' && (
        <main className="people-page">
          <section className="people-hero">
            <span className="eyebrow">TRAVEL TOGETHER</span>
            <h1>同行</h1>
            <p>把行程发给朋友。同行设备在同一 Wi-Fi 下通过房间交换行程快照，不需要账号或公网。当前先支持手动发布/拉取。</p>
          </section>

          <section className="people-card lan-card">
            <div className="people-title"><strong>局域网同步</strong><span>{lanSupported() ? '同一 Wi-Fi · 无云端' : '仅 Android App 可用'}</span></div>
            {lanInfo && lanRole ? (
              <>
                <div className="lan-room">
                  <div><span>地址</span><strong>{lanInfo.ip}:{lanInfo.port}</strong></div>
                  <div><span>房间码</span><strong>{lanInfo.room}</strong></div>
                  <div><span>版本</span><strong>v{lanInfo.version}</strong></div>
                  <div><span>在线</span><strong>{lanMembers.length || 1} 人</strong></div>
                </div>
                {lanMembers.length > 0 && <p className="lan-members">{lanMembers.join(' · ')}</p>}
                <div className="people-actions">
                  {lanRole === 'host' ? (
                    <>
                      <button className="primary" disabled={lanBusy} onClick={publishHost}>发布当前行程</button>
                      <button className="text-btn" disabled={lanBusy} onClick={pullHost}>拉取最新</button>
                      <button className="text-btn danger" onClick={closeRoom}>关闭房间</button>
                    </>
                  ) : (
                    <>
                      <button className="primary" disabled={lanBusy} onClick={pullHost}>拉取最新</button>
                      <button className="text-btn" disabled={lanBusy} onClick={pushGuest}>推送本机行程</button>
                      <button className="text-btn" onClick={() => { setLanInfo(null); setLanRole(null); setLanMembers([]); setLanStatus('已离开房间'); }}>离开</button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="people-note">同一 Wi-Fi 下交换行程快照，不需要账号或公网。房主需要 Android App；同行设备可以是 Android 或浏览器。</p>
                {lanSupported() && <button className="primary lan-host-btn" disabled={lanBusy} onClick={startRoom}>开启房间（房主）</button>}
                <div className="lan-join">
                  <span>{lanSupported() ? '或加入房间' : '输入房主地址加入'}</span>
                  <input value={lanGuest.ip} onChange={(e) => setLanGuest((prev) => ({ ...prev, ip: e.target.value }))} placeholder="房主 IP，如 192.168.1.10" />
                  <input value={lanGuest.room} onChange={(e) => setLanGuest((prev) => ({ ...prev, room: e.target.value }))} placeholder="6 位房间码" />
                  <button className="text-btn" disabled={lanBusy} onClick={joinRoom}>加入并拉取</button>
                </div>
              </>
            )}
            {lanStatus && <p className="lan-status">{lanStatus}</p>}
          </section>

          <section className="people-card">
            <div className="people-title"><strong>同行的人</strong><span>局域网房间</span></div>
            <div className="people-avatars">
              <span className="person-avatar self">你</span>
              <button className="person-invite" onClick={() => setNotice('协作邀请将在下一阶段接入')}>＋ 邀请</button>
            </div>
            <p className="people-note">当前是手动快照同步：房主发布，同行拉取/推送。自动实时同步、权限和冲突合并还在 M3.1/M3.2。</p>
          </section>

          <section className="people-card">
            <div className="people-title"><strong>分享当前行程</strong><span>{trip.days.length} 天 · {totalStops} 地点</span></div>
            <div className="people-actions">
              <button className="primary" onClick={copySummary}>复制行程摘要</button>
              <button className="text-btn" onClick={exportTrip}>导出 JSON 备份</button>
            </div>
            <p className="people-note">摘要包含每天的城市、日期和地点顺序；备份可用于后续导入。</p>
          </section>

          <section className="people-card">
            <div className="people-title"><strong>当前行程</strong><span>{pack.city}</span></div>
            <div className="people-trip-meta">
              <span>{trip.startDate} — {trip.days[trip.days.length - 1].date}</span>
              <span>{trip.days.length} 天 · {totalStops} 个地点 · {tripMeters ? formatKm(tripMeters) : '—'}</span>
            </div>
            <button className="text-btn" onClick={() => { setPage('overview'); setNotice('回到行程总览'); }}>打开行程总览 →</button>
          </section>

          <footer className="app-footer">
            <span>同一 Wi-Fi · 无账号 · 无云端</span>
            <span>{pack.city} · {pack.version}</span>
          </footer>
        </main>
      )}

      <nav className="app-tabbar" aria-label="主导航">
        <button className={page === 'overview' ? 'active' : ''} onClick={() => setPage('overview')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
          <span>行程</span>
        </button>
        <button
          className={page === 'day' ? 'active' : ''}
          onClick={() => { setPage('day'); setMapMounted(true); }}
          onPointerEnter={() => setMapMounted(true)}
          onTouchStart={() => setMapMounted(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>
          <span>当天</span>
        </button>
        <button className={page === 'people' ? 'active' : ''} onClick={() => setPage('people')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.2" /><path d="M3.5 19c.6-3 2.6-4.7 5.5-4.7S14 16 14.6 19M15 14.5c2.4.2 4.1 1.7 4.6 4.5" /></svg>
          <span>同行</span>
        </button>
      </nav>

      {notice && <div className="app-notice">{notice}</div>}

      {packSheet}
      {addOpen && <AddPlaceSheet city={dayCity} existing={stops.map((s) => s.placeId)} onAdd={addPlace} onClose={() => setAddOpen(false)} />}
      {mapPick && (
        <MapPickSheet
          city={dayCity}
          point={mapPick}
          existing={stops.map((s) => s.placeId)}
          onAdd={(place) => { addPlace(place); setMapPick(null); }}
          onClose={() => setMapPick(null)}
        />
      )}
      {lodgingOpen && (
        <LodgingSheet day={activeDay} onSave={updateLodging} onClose={() => setLodgingOpen(false)} />
      )}
      {selectedStop && (
        <StopSheet
          stop={selectedStop}
          index={selectedIndex}
          isLast={selectedIndex === stops.length - 1}
          days={trip.days.map((day) => ({ id: day.id, label: day.label, title: day.title, cityId: day.cityId ?? activeCity }))}
          currentDayId={activeDay.id}
          currentDayCity={dayCity}
          onClose={() => setStopOpenId(null)}
          onChange={(patch) => updateStop(selectedStop.id, patch)}
          onDelete={() => deleteStop(selectedStop.id)}
          onCopyToDay={(dayId) => copyStopToDay(selectedStop.id, dayId)}
        />
      )}
      {deleteDayId && (
        <ConfirmSheet
          title="删除这一天？"
          body="这一天的地点和路线会从本机移除，不影响其他天。"
          confirmLabel="删除这一天"
          onConfirm={confirmDeleteDay}
          onClose={() => setDeleteDayId(null)}
        />
      )}
      {deleteConfirmCity && (
        <ConfirmSheet
          title={`删除 ${packs[deleteConfirmCity].city} 地图包？`}
          body={`将从本机缓存中删除 ${formatBytes(packs[deleteConfirmCity].sizeBytes)} 的地图与路网。之后可以重新下载。`}
          confirmLabel="删除并释放空间"
          onConfirm={confirmDelete}
          onClose={() => setDeleteConfirmCity(null)}
        />
      )}
      {deleteFineCity && (
        <ConfirmSheet
          title={`删除 ${packs[deleteFineCity].city} 精细底图？`}
          body="只删除 z16/z17 精细瓦片，标准地图包和路网保留。之后可以重新下载。"
          confirmLabel="删除精细底图"
          onConfirm={confirmDeleteFine}
          onClose={() => setDeleteFineCity(null)}
        />
      )}
    </div>
  );
}

type StopRowProps = {
  stop: Stop;
  index: number;
  arrive: number;
  leave: number;
  leg?: LegRoute;
  active: boolean;
  onOpen: () => void;
  onToggleTransport: () => void;
};

function StopRow({ stop, index, arrive, leave, leg, active, onOpen, onToggleTransport }: StopRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`stop-item${isDragging ? ' dragging' : ''}`}>
      <div className="stop-time"><strong>{formatTime(arrive)}</strong><span>{formatTime(leave)}</span></div>
      <div className="stop-rail"><span className="stop-dot" /></div>
      <article className={`stop-card${active ? ' active' : ''}`} onClick={onOpen}>
        <div className="stop-card-head">
          <span className="stop-index">{String(index + 1).padStart(2, '0')}</span>
          <div className="stop-title"><h3>{stop.name}</h3><p>{stop.transportInfo ? `${stop.transportInfo.kind === 'flight' ? '航班' : stop.transportInfo.kind === 'train' ? '高铁/火车' : stop.transportInfo.kind === 'bus' ? '大巴' : stop.transportInfo.kind === 'ferry' ? '轮渡' : '交通'} ${stop.transportInfo.number || ''} · ${stop.transportInfo.from || '出发'} → ${stop.transportInfo.to || '到达'} · ${stop.transportInfo.departTime || '--:--'}–${stop.transportInfo.arriveTime || '--:--'}` : `${stop.category} · 停留 ${stop.durationMin} 分钟${stop.fixedTime ? ` · 固定 ${stop.fixedTime}` : ''}`}</p></div>
          <button
            className="drag-handle"
            aria-label="拖动排序"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          ><span /><span /><span /><span /><span /><span /></button>
        </div>
        {stop.notes && <p className="stop-note-text">{stop.notes}</p>}
        <div className="stop-card-foot">
          <span className="stop-meta">{stop.booking ? `预订 · ${stop.booking}` : '未填预订'}</span>
          <button className="mini-transport" onClick={(e) => { e.stopPropagation(); onToggleTransport(); }}>
            {stop.transportToNext === 'walk' ? '步行' : '打车'} ⇄
          </button>
        </div>
        {leg && <span className="stop-distance">{formatKm(leg.distanceM)} → 下一站</span>}
      </article>
    </div>
  );
}

export default App;
