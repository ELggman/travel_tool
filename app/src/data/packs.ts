import type {
  AvailableCityId, CityId, PackInfo, Place, Province, Stop, Theme, Trip,
} from './types';
import { placesByCity } from './places.generated';

export const themes: Record<CityId, Theme> = {
  chongqing: {
    paper: '#F2EDE1', paperDeep: '#E8DFCE', ink: '#1E2822', muted: '#777567',
    accent: '#C64C2D', accent2: '#405942', water: '#B9D5D1', land: '#EDE7D8',
    green: '#C8D5B0', road: '#FBF7EC', line: '#DED5C2', heroA: '#E7DAC4', heroB: '#F3EEE2',
  },
  wuhan: {
    paper: '#EEF2EF', paperDeep: '#DDE8E3', ink: '#1E2B2D', muted: '#6F7A76',
    accent: '#2E6F91', accent2: '#B46A3C', water: '#B4D1DA', land: '#E8ECE1',
    green: '#C8D8B7', road: '#F8FBF5', line: '#D4E0D8', heroA: '#D6E4E1', heroB: '#EDF2EF',
  },
  guiyang: {
    paper: '#F0EEE2', paperDeep: '#E4E1CE', ink: '#293026', muted: '#737664',
    accent: '#6C7C48', accent2: '#B67543', water: '#B8D1C7', land: '#E8E7D3',
    green: '#C6D2AB', road: '#FAF8EC', line: '#DCD8C5', heroA: '#E1DEC6', heroB: '#F0EEE2',
  },
  harbin: {
    paper: '#EEF3F4', paperDeep: '#DCE7EA', ink: '#1E2B2D', muted: '#6E7B7D',
    accent: '#3D6F7A', accent2: '#8B5E4A', water: '#C5DDE4', land: '#E7EEE8',
    green: '#BCCFBF', road: '#F8FCFC', line: '#D5E2E3', heroA: '#D9E7EB', heroB: '#EEF3F4',
  },
};

export const provinces: Province[] = [
  { id: 'chongqing', name: '重庆', short: '渝', theme: themes.chongqing, cityIds: ['chongqing'] },
  { id: 'hubei', name: '湖北', short: '鄂', theme: themes.wuhan, cityIds: ['wuhan'] },
  { id: 'guizhou', name: '贵州', short: '黔', theme: themes.guiyang, cityIds: ['guiyang'] },
  { id: 'heilongjiang', name: '黑龙江', short: '黑', theme: themes.harbin, cityIds: ['harbin'] },
];

export const packs: Record<CityId, PackInfo> = {
  chongqing: {
    id: 'chongqing', provinceId: 'chongqing', city: '重庆', short: '渝',
    title: '山城，向上走', tagline: '两江交汇，巷子尽头是江风',
    sizeBytes: 78_486_871, version: '2026.10-wide', available: true, downloadedByDefault: true,
    fine: { available: true, sizeBytes: 7_654_726, version: '2026.10-fine', maxzoom: 16 },
  },
  wuhan: {
    id: 'wuhan', provinceId: 'hubei', city: '武汉', short: '鄂',
    title: '江城，过江去', tagline: '一桥两江，过早与晚风',
    sizeBytes: 21_201_779, version: '2026.10', available: true, downloadedByDefault: false,
  },
  guiyang: {
    id: 'guiyang', provinceId: 'guizhou', city: '贵阳', short: '黔',
    title: '黔中，慢一点', tagline: '山在城里，城在山里',
    sizeBytes: 10_115_437, version: '2026.10', available: true, downloadedByDefault: false,
  },
  harbin: {
    id: 'harbin', provinceId: 'heilongjiang', city: '哈尔滨', short: '黑',
    title: '北境，等一场雪', tagline: '松花江畔，冰雪与面包',
    sizeBytes: 0, version: '待接入', available: false, downloadedByDefault: false,
  },
};

export const availableCities: AvailableCityId[] = ['chongqing', 'wuhan', 'guiyang'];

export function cityPlaces(city: AvailableCityId): Place[] {
  return placesByCity[city];
}

export function provinceOf(city: CityId): Province {
  return provinces.find((p) => p.cityIds.includes(city)) ?? provinces[0];
}

const seedIds: Record<AvailableCityId, string[]> = {
  chongqing: ['jiefangbei', 'hongyadong', 'shibati', 'raffles'],
  wuhan: ['huanghelou', 'hubuxiang', 'jianghanlu', 'wuhanguan'],
  guiyang: ['jiaxiulou', 'wengchangge', 'penshuichi', 'huaguoyuan'],
};

export function makeStop(place: Place, transportToNext: 'walk' | 'taxi' = 'walk'): Stop {
  return {
    id: `${place.id}-${Math.random().toString(36).slice(2, 8)}`,
    placeId: place.id,
    name: place.name,
    category: place.category,
    lon: place.lon,
    lat: place.lat,
    durationMin: place.durationMin,
    transportToNext,
    booking: '',
  };
}

export function seedTrip(city: AvailableCityId): Trip {
  const stops = seedIds[city]
    .map((id) => cityPlaces(city).find((p) => p.id === id))
    .filter((p): p is Place => Boolean(p))
    .map((p, i) => makeStop(p, i === 1 ? 'taxi' : 'walk'));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    id: `trip-${city}`,
    cityId: city,
    title: packs[city].title,
    day: {
      id: `day-${city}-1`,
      date,
      label: 'DAY 01',
      startTime: '09:30',
      stops,
    },
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
