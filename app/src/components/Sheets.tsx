import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { cityPlaces, formatBytes, packs, provinces } from '../data/packs';
import type { AvailableCityId, CityId, Stop, Transport } from '../data/types';

type SheetProps = { onClose: () => void; children: ReactNode; wide?: boolean; className?: string };

function Sheet({ onClose, children, wide, className = '' }: SheetProps) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`sheet ${wide ? 'sheet-wide' : ''} ${className}`} role="dialog" aria-modal="true">
        <div className="sheet-grab" />
        {children}
      </section>
    </div>
  );
}

type PackSheetProps = {
  activeCity: AvailableCityId;
  downloaded: CityId[];
  previewCity: CityId | null;
  progress: Partial<Record<CityId, number>>;
  error: string | null;
  onClose: () => void;
  onPreview: (city: CityId) => void;
  onSelect: (city: AvailableCityId) => void;
  onDownload: (city: AvailableCityId) => void;
  onDelete: (city: AvailableCityId) => void;
};

export function PackSheet({
  activeCity, downloaded, previewCity, progress, error, onClose, onPreview, onSelect, onDownload, onDelete,
}: PackSheetProps) {
  const activeProvince = provinces.find((p) => p.cityIds.includes(activeCity)) ?? provinces[0];
  const [provinceId, setProvinceId] = useState(activeProvince.id);
  const province = provinces.find((p) => p.id === provinceId) ?? provinces[0];
  const used = downloaded.reduce((sum, id) => sum + packs[id].sizeBytes, 0);

  useEffect(() => {
    if (previewCity) {
      const p = provinces.find((x) => x.cityIds.includes(previewCity));
      if (p) setProvinceId(p.id);
    }
  }, [previewCity]);

  return (
    <Sheet onClose={onClose} wide className="pack-sheet">
      <header className="sheet-head">
        <div>
          <span className="eyebrow">OFFLINE MAP PACKS</span>
          <h2>地图包</h2>
          <p>按省份 / 城市下载，只保留你要去的地方。</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
      </header>

      <div className="province-strip">
        {provinces.map((p) => (
          <button
            key={p.id}
            className={`province-chip${p.id === provinceId ? ' active' : ''}`}
            style={{ '--chip': p.theme.accent, '--chip-paper': p.theme.paper } as CSSProperties}
            onClick={() => {
              setProvinceId(p.id);
              if (p.cityIds[0]) onPreview(p.cityIds[0]);
            }}
          >
            <span className="province-seal">{p.short}</span>
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      <div className="pack-list">
        {province.cityIds.map((cityId) => {
          const info = packs[cityId];
          const isDownloaded = downloaded.includes(cityId);
          const isActive = activeCity === cityId;
          const pct = progress[cityId];
          return (
            <article
              key={cityId}
              className={`pack-card${isActive ? ' active' : ''}${previewCity === cityId ? ' preview' : ''}`}
              onClick={() => onPreview(cityId)}
            >
              <div className="pack-card-top">
                <span className="pack-seal" style={{ background: province.theme.accent }}>{info.short}</span>
                <div className="pack-name">
                  <h3>{info.city}</h3>
                  <p>{info.tagline}</p>
                </div>
                <span className={`pack-status ${isDownloaded ? 'ok' : info.available ? '' : 'soon'}`}>
                  {isDownloaded ? '已下载' : info.available ? formatBytes(info.sizeBytes) : '准备中'}
                </span>
              </div>
              <div className="pack-meta">
                <span>{province.name} · {info.version}</span>
                <span>{info.available ? '离线底图 + 步行/打车路网' : '地图数据尚未接入'}</span>
              </div>
              {pct !== undefined && pct < 100 && (
                <div className="download-track"><span style={{ width: `${pct}%` }} /></div>
              )}
              <div className="pack-actions">
                {isDownloaded ? (
                  <>
                    <button className="primary small" onClick={(e) => { e.stopPropagation(); onSelect(cityId as AvailableCityId); }}>
                      {isActive ? '当前城市' : '使用这个城市'}
                    </button>
                    <button className="text-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(cityId as AvailableCityId); }}>
                      删除
                    </button>
                  </>
                ) : info.available ? (
                  <button
                    className="primary small"
                    disabled={pct !== undefined && pct < 100}
                    onClick={(e) => { e.stopPropagation(); onDownload(cityId as AvailableCityId); }}
                  >
                    {pct !== undefined && pct < 100 ? `下载中 ${pct}%` : '下载地图包'}
                  </button>
                ) : (
                  <button className="primary small" disabled>即将支持</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {error && <div className="form-error">{error}</div>}
      <footer className="pack-footer">
        <span>已下载 {downloaded.length} 个城市</span>
        <strong>占用 {formatBytes(used)}</strong>
      </footer>
      <p className="sheet-note">M1 演示：底图与路网随展示包提供；下载接口按城市包读取 manifest / 路网，后续替换为对象存储 CDN。</p>
    </Sheet>
  );
}

type AddPlaceSheetProps = {
  city: AvailableCityId;
  existing: string[];
  onAdd: (placeId: string) => void;
  onClose: () => void;
};

export function AddPlaceSheet({ city, existing, onAdd, onClose }: AddPlaceSheetProps) {
  const [query, setQuery] = useState('');
  const places = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cityPlaces(city).filter((p) => !q || `${p.name}${p.category}`.toLowerCase().includes(q));
  }, [city, query]);

  return (
    <Sheet onClose={onClose}>
      <header className="sheet-head">
        <div>
          <span className="eyebrow">ADD A PLACE</span>
          <h2>加一个地点</h2>
          <p>M1 先用精选地点；下一版接离线 POI 搜索。</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <label className="search-field">
        <span>⌕</span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索地点或类别" />
      </label>
      <div className="place-list">
        {places.map((place) => {
          const added = existing.includes(place.id);
          return (
            <button
              key={place.id}
              className={`place-row${added ? ' added' : ''}`}
              disabled={added}
              onClick={() => { onAdd(place.id); onClose(); }}
            >
              <span className="place-symbol">{place.category.slice(0, 1)}</span>
              <span className="place-main"><strong>{place.name}</strong><small>{place.category} · 建议停留 {place.durationMin} 分钟</small></span>
              <span className="place-action">{added ? '已加' : '＋'}</span>
            </button>
          );
        })}
        {!places.length && <p className="empty-note">没有匹配的地点。</p>}
      </div>
    </Sheet>
  );
}

type StopSheetProps = {
  stop: Stop;
  index: number;
  isLast: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Stop>) => void;
  onDelete: () => void;
};

export function StopSheet({ stop, index, isLast, onClose, onChange, onDelete }: StopSheetProps) {
  return (
    <Sheet onClose={onClose}>
      <header className="sheet-head">
        <div>
          <span className="eyebrow">STOP {String(index + 1).padStart(2, '0')}</span>
          <h2>{stop.name}</h2>
          <p>{stop.category} · 拖动手柄可以调整顺序</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
      </header>

      <div className="field-group">
        <label>停留时长</label>
        <div className="stepper">
          <button onClick={() => onChange({ durationMin: Math.max(10, stop.durationMin - 5) })}>−</button>
          <strong>{stop.durationMin} 分钟</strong>
          <button onClick={() => onChange({ durationMin: Math.min(240, stop.durationMin + 5) })}>＋</button>
        </div>
      </div>

      {!isLast && (
        <div className="field-group">
          <label>去下一站</label>
          <div className="segment">
            {(['walk', 'taxi'] as Transport[]).map((mode) => (
              <button
                key={mode}
                className={stop.transportToNext === mode ? 'active' : ''}
                onClick={() => onChange({ transportToNext: mode })}
              >
                {mode === 'walk' ? '步行' : '打车'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field-group">
        <label>预订 / 备注</label>
        <input
          className="text-input"
          value={stop.booking}
          onChange={(e) => onChange({ booking: e.target.value })}
          placeholder="例如：16:00 入场，已出票"
        />
      </div>

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>完成</button>
        <button className="text-btn danger" onClick={() => { onDelete(); onClose(); }}>删除这个地点</button>
      </div>
    </Sheet>
  );
}
