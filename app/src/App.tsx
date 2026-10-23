import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MapView from './components/MapView';
import { AddPlaceSheet, PackSheet, StopSheet } from './components/Sheets';
import { useRouting } from './hooks/useRouting';
import {
  availableCities, cityPlaces, makeStop, packs, provinceOf, seedTrip, themes,
} from './data/packs';
import type { AvailableCityId, CityId, LegRoute, Stop, Theme, Transport, Trip } from './data/types';
import { dateLabel, formatDuration, formatKm, formatTime, parseTime } from './utils';

type Persisted = {
  activeCity: AvailableCityId;
  downloaded: CityId[];
  trips: Record<AvailableCityId, Trip>;
};

const STORAGE_KEY = 'yanlu.m1.v1';

function initialPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Persisted>;
      const downloaded: CityId[] = Array.isArray(saved.downloaded) && saved.downloaded.length
        ? saved.downloaded.filter((id): id is CityId => id in packs)
        : ['chongqing'];
      const trips = {} as Record<AvailableCityId, Trip>;
      for (const city of availableCities) {
        const savedTrip = saved.trips?.[city];
        trips[city] = savedTrip && savedTrip.day?.stops?.length ? savedTrip : seedTrip(city);
      }
      const active = saved.activeCity && downloaded.includes(saved.activeCity) && availableCities.includes(saved.activeCity as AvailableCityId)
        ? saved.activeCity as AvailableCityId
        : (downloaded.find((id): id is AvailableCityId => availableCities.includes(id as AvailableCityId)) ?? 'chongqing');
      return { activeCity: active, downloaded, trips };
    }
  } catch {
    // fall through to seed
  }
  const trips = {} as Record<AvailableCityId, Trip>;
  for (const city of availableCities) trips[city] = seedTrip(city);
  return { activeCity: 'chongqing', downloaded: ['chongqing'], trips };
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
  const [stopOpenId, setStopOpenId] = useState<string | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<CityId, number>>>({});
  const [packError, setPackError] = useState<string | null>(null);

  const activeCity = state.activeCity;
  const trip = state.trips[activeCity];
  const stops = trip.day.stops;
  const pack = packs[activeCity];
  const province = provinceOf(activeCity);
  const baseTheme = themes[activeCity];
  const previewTheme = previewCity ? themes[previewCity] : baseTheme;
  const pageTheme = packOpen ? previewTheme : baseTheme;

  const { legs, loading } = useRouting(activeCity, stops);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const timeline = useMemo(() => {
    let cursor = parseTime(trip.day.startTime);
    return stops.map((stop, i) => {
      const arrive = cursor;
      const leave = arrive + stop.durationMin;
      const leg = legs[i];
      cursor = leave + (leg?.durationMin ?? 0);
      return { stop, arrive, leave, leg };
    });
  }, [stops, legs, trip.day.startTime]);

  const totalMeters = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const totalMinutes = timeline.length
    ? timeline[timeline.length - 1].leave - parseTime(trip.day.startTime)
    : 0;

  const updateStops = (next: Stop[] | ((current: Stop[]) => Stop[])) => {
    setState((prev) => {
      const currentTrip = prev.trips[prev.activeCity];
      const nextStops = typeof next === 'function' ? next(currentTrip.day.stops) : next;
      return {
        ...prev,
        trips: {
          ...prev.trips,
          [prev.activeCity]: { ...currentTrip, day: { ...currentTrip.day, stops: nextStops } },
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
          [prev.activeCity]: { ...currentTrip, day: { ...currentTrip.day, startTime } },
        },
      };
    });
  };

  const updateStop = (id: string, patch: Partial<Stop>) => {
    updateStops((current) => current.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));
  };

  const addPlace = (placeId: string) => {
    const place = cityPlaces(activeCity).find((p) => p.id === placeId);
    if (!place) return;
    updateStops((current) => {
      if (current.some((s) => s.placeId === placeId)) return current;
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
    setProgress((prev) => ({ ...prev, [city]: 2 }));
    try {
      const manifestResponse = await fetch(`/packs/${city}/manifest.json`);
      if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
      const manifest = await manifestResponse.json() as { sizeBytes?: number; walkBytes?: number; carBytes?: number; walk?: string; car?: string };
      const total = (manifest.walkBytes ?? 0) + (manifest.carBytes ?? 0) || manifest.sizeBytes || packs[city].sizeBytes;
      let loaded = 0;
      for (const file of [manifest.walk ?? 'walk.json', manifest.car ?? 'car.json']) {
        const response = await fetch(`/packs/${city}/${file}`);
        if (!response.ok) throw new Error(`${file} ${response.status}`);
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            const pct = Math.min(99, Math.round((loaded / total) * 100));
            setProgress((prev) => ({ ...prev, [city]: pct }));
          }
        } else {
          loaded += Number(response.headers.get('content-length') ?? 0);
        }
      }
      setProgress((prev) => ({ ...prev, [city]: 100 }));
      setState((prev) => ({
        ...prev,
        downloaded: prev.downloaded.includes(city) ? prev.downloaded : [...prev.downloaded, city],
        trips: prev.trips[city] ? prev.trips : { ...prev.trips, [city]: seedTrip(city) },
      }));
      window.setTimeout(() => setProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      }), 700);
    } catch (err) {
      setPackError(`下载失败：${err instanceof Error ? err.message : String(err)}`);
      setProgress((prev) => {
        const next = { ...prev }; delete next[city]; return next;
      });
    }
  };

  const deletePack = (city: AvailableCityId) => {
    if (state.downloaded.length <= 1) { setPackError('至少保留一个城市地图包。'); return; }
    if (!window.confirm(`删除 ${packs[city].city} 的离线地图包？`)) return;
    setState((prev) => {
      const downloaded = prev.downloaded.filter((id) => id !== city);
      const active = prev.activeCity === city
        ? (downloaded.find((id): id is AvailableCityId => availableCities.includes(id as AvailableCityId)) ?? 'chongqing')
        : prev.activeCity;
      return { ...prev, downloaded, activeCity: active };
    });
    if ('caches' in window) caches.delete(`yanlu-pack-${city}`).catch(() => {});
    setPreviewCity(null);
  };

  const selectedStop = stopOpenId ? stops.find((s) => s.id === stopOpenId) ?? null : null;
  const selectedIndex = selectedStop ? stops.findIndex((s) => s.id === selectedStop.id) : -1;
  const titleParts = pack.title.split('，');

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
        <button className="city-pill" onClick={() => { setPackOpen(true); setPreviewCity(activeCity); }}>
          <span className="city-seal">{pack.short}</span>
          <span className="city-pill-text"><strong>{province.name === pack.city ? pack.city : `${province.name} · ${pack.city}`}</strong><small>{state.downloaded.includes(activeCity) ? '离线包已就绪' : '下载地图包'}</small></span>
          <span className="chev">⌄</span>
        </button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-orbit" aria-hidden="true" />
          <div className="hero-content">
            <div className="hero-kicker"><span>{province.name} · {pack.version}</span><span>{trip.day.label} · {dateLabel(trip.day.date)}</span></div>
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
            city={activeCity}
            theme={baseTheme}
            stops={stops}
            legs={legs}
            activeStopId={activeStopId}
            onSelectStop={(id) => { setActiveStopId(id); setStopOpenId(id); }}
          />
          <div className="map-badge">{loading ? '正在重算路线…' : totalMeters ? `${formatKm(totalMeters)} · ${legs.length} 段` : '还没有路线'}</div>
        </section>

        <section className="day-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">YOUR DAY</span>
              <h2>今天的路线</h2>
            </div>
            <label className="time-picker">出发<input type="time" value={trip.day.startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
          </div>

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

      {packOpen && (
        <PackSheet
          activeCity={activeCity}
          downloaded={state.downloaded}
          previewCity={previewCity}
          progress={progress}
          error={packError}
          onClose={() => { setPackOpen(false); setPreviewCity(null); setPackError(null); }}
          onPreview={setPreviewCity}
          onSelect={selectCity}
          onDownload={downloadPack}
          onDelete={deletePack}
        />
      )}
      {addOpen && <AddPlaceSheet city={activeCity} existing={stops.map((s) => s.placeId)} onAdd={addPlace} onClose={() => setAddOpen(false)} />}
      {selectedStop && (
        <StopSheet
          stop={selectedStop}
          index={selectedIndex}
          isLast={selectedIndex === stops.length - 1}
          onClose={() => setStopOpenId(null)}
          onChange={(patch) => updateStop(selectedStop.id, patch)}
          onDelete={() => deleteStop(selectedStop.id)}
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
          <div className="stop-title"><h3>{stop.name}</h3><p>{stop.category} · 停留 {stop.durationMin} 分钟</p></div>
          <button
            className="drag-handle"
            aria-label="拖动排序"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          ><span /><span /><span /><span /><span /><span /></button>
        </div>
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
