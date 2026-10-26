import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
  const [focusFine, setFocusFine] = useState(0);

  const activeCity = state.activeCity;
  const trip = state.trips[activeCity];
  const activeDay = trip.days.find((day) => day.id === trip.activeDayId) ?? trip.days[0];
  const activeDayIndex = trip.days.findIndex((day) => day.id === activeDay.id);
  const dayCity = activeDay.cityId && state.downloaded.includes(activeDay.cityId) ? activeDay.cityId : activeCity;
  const stops = activeDay.stops;
  const pack = packs[dayCity];
  const province = provinceOf(dayCity);
  const baseTheme = themes[dayCity];
  const previewTheme = previewCity ? themes[previewCity] : baseTheme;
  const pageTheme = packOpen ? previewTheme : baseTheme;

  const { legs, loading } = useRouting(dayCity, stops, state.downloaded.includes(dayCity));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
    let cursor = parseTime(activeDay.startTime);
    return stops.map((stop, i) => {
      const fixed = stop.fixedTime ? parseTime(stop.fixedTime) : null;
      const arrive = fixed ? Math.max(cursor, fixed) : cursor;
      const leave = arrive + stop.durationMin;
      const leg = legs[i];
      cursor = leave + (leg?.durationMin ?? 0);
      return { stop, arrive, leave, leg };
    });
  }, [stops, legs, activeDay.startTime]);

  const totalMeters = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const totalMinutes = timeline.length
    ? timeline[timeline.length - 1].leave - parseTime(activeDay.startTime)
    : 0;
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

  return (
    <div className="app" style={themeVars(pageTheme)} data-city={activeCity}>
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
          <span className="city-pill-text"><strong>{province.name === pack.city ? pack.city : `${province.name} · ${pack.city}`}</strong><small>{state.downloaded.includes(activeCity) ? '离线包已就绪' : '下载地图包'}</small></span>
          <span className="chev">⌄</span>
        </button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-orbit" aria-hidden="true" />
          <div className="hero-content">
            <div className="hero-kicker"><span>{province.name} · {pack.version}</span><span>{activeDay.label} · {dateLabel(activeDay.date)}</span></div>
            <h1>{titleParts[0]}{titleParts[1] && <><br /><em>{titleParts[1]}</em></>}</h1>
            <p>{pack.tagline}</p>
            <div className="hero-stats">
              <div><strong>{stops.length}</strong><span>个地点</span></div>
              <div><strong>{totalMeters ? formatKm(totalMeters) : '—'}</strong><span>今日路线</span></div>
              <div><strong>{totalMinutes ? formatDuration(totalMinutes) : '—'}</strong><span>含停留</span></div>
            </div>
          </div>
          <span className="hero-seal" aria-hidden="true">{pack.short}</span>
        </section>

        <section className="map-card">
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
          />
          <div className="map-badge">{loading ? '正在重算路线…' : totalMeters ? `${formatKm(totalMeters)} · ${legs.length} 段` : '还没有路线'}</div>
        </section>

        <div className="trip-start-row">
          <label className="trip-start">行程出发日期<input type="date" value={trip.startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <span>{trip.days.length} 天 · 每天独立路线</span>
          <label className="day-city-select">城市<select value={dayCity} onChange={(e) => updateDayCity(e.target.value as AvailableCityId)}>
            {state.downloaded.map((city) => <option key={city} value={city}>{packs[city].city}</option>)}
          </select></label>
          {activeDayIndex > 0 && <button className="text-btn day-copy" onClick={copyPreviousDay}>复制前一天</button>}
        </div>

        <section className="trip-overview" aria-label="多日总览">
          <div><strong>{trip.days.length}</strong><span>天</span></div>
          <div><strong>{totalStops}</strong><span>个地点</span></div>
          <div><strong>{totalStayMinutes ? formatDuration(totalStayMinutes) : '—'}</strong><span>总停留</span></div>
          <div><strong>{totalMeters ? formatKm(totalMeters) : '—'}</strong><span>当天路线</span></div>
        </section>

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

          <button className="lodging-card" onClick={() => setLodgingOpen(true)}>
            {activeDay.lodging ? (
              <>
                <strong>住宿 · {activeDay.lodging.name}</strong>
                <span>入住 {activeDay.lodging.checkIn} · 退房 {activeDay.lodging.checkOut}</span>
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

        <footer className="app-footer">
          <span>本地地图 · 本地路网 · 无外部请求</span>
          <span>{pack.city} · {pack.version}</span>
        </footer>
      </main>

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
          <div className="stop-title"><h3>{stop.name}</h3><p>{stop.category} · 停留 {stop.durationMin} 分钟{stop.fixedTime ? ` · 固定 ${stop.fixedTime}` : ''}</p></div>
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
