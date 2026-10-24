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
  fineDownloaded: CityId[];
  fineProgress: Partial<Record<CityId, number>>;
  onDownloadFine: (city: AvailableCityId) => void;
  onDeleteFine: (city: AvailableCityId) => void;
  packBase: string;
  onPackBaseChange: (value: string) => void;
};

export function PackSheet({
  activeCity, downloaded, previewCity, progress, error, onClose, onPreview, onSelect, onDownload, onDelete,
  fineDownloaded, fineProgress, onDownloadFine, onDeleteFine, packBase, onPackBaseChange,
}: PackSheetProps) {
  const activeProvince = provinces.find((p) => p.cityIds.includes(activeCity)) ?? provinces[0];
  const [provinceId, setProvinceId] = useState(activeProvince.id);
  const province = provinces.find((p) => p.id === provinceId) ?? provinces[0];
  const used = downloaded.reduce((sum, id) => sum + packs[id].sizeBytes, 0)
    + fineDownloaded.reduce((sum, id) => sum + (packs[id].fine?.sizeBytes ?? 0), 0);

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
              {isDownloaded && info.fine?.available && (
                <div className="fine-pack">
                  <div className="fine-pack-copy">
                    <strong>核心区精细 · z{info.fine.maxzoom}</strong>
                    <span>{formatBytes(info.fine.sizeBytes)} · 更细的建筑/道路，适合实际导航</span>
                  </div>
                  {fineDownloaded.includes(cityId) ? (
                    <button className="text-btn danger" onClick={(e) => { e.stopPropagation(); onDeleteFine(cityId as AvailableCityId); }}>删除精细</button>
                  ) : (
                    <button className="text-btn" onClick={(e) => { e.stopPropagation(); onDownloadFine(cityId as AvailableCityId); }}>下载精细底图</button>
                  )}
                  {fineProgress[cityId] !== undefined && fineProgress[cityId]! < 100 && (
                    <div className="download-track"><span style={{ width: `${fineProgress[cityId]}%` }} /></div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {error && <div className="form-error">{error}</div>}
      <footer className="pack-footer">
        <span>已下载 {downloaded.length} 个城市{fineDownloaded.length ? ` · 精细 ${fineDownloaded.length}` : ''}</span>
        <strong>占用 {formatBytes(used)}</strong>
      </footer>
      <div className="pack-server">
        <label htmlFor="pack-base">包服务器</label>
        <input
          id="pack-base"
          value={packBase}
          onChange={(e) => onPackBaseChange(e.target.value)}
          placeholder="http://192.168.1.10:8090"
          spellCheck={false}
          autoCapitalize="off"
        />
        <small>真机填 Mac 局域网 IP；模拟器默认 10.0.2.2:8090</small>
      </div>
      <p className="sheet-note">真实归档下载：下载后解压到本机 CacheStorage，地图与路网都从本机读取；删除会真正清理缓存。生产环境替换为 OSS/COS CDN 地址。</p>
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

type ConfirmSheetProps = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmSheet({ title, body, confirmLabel, onConfirm, onClose }: ConfirmSheetProps) {
  return (
    <Sheet onClose={onClose}>
      <header className="sheet-head">
        <div>
          <span className="eyebrow">CONFIRM</span>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
      </header>
      <div className="sheet-actions">
        <button className="primary danger-solid" onClick={onConfirm}>{confirmLabel}</button>
        <button className="text-btn" onClick={onClose}>取消</button>
      </div>
    </Sheet>
  );
}
