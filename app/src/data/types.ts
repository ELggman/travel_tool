export type CityId = 'chongqing' | 'wuhan' | 'guiyang' | 'harbin';
export type AvailableCityId = Exclude<CityId, 'harbin'>;
export type Transport = 'walk' | 'taxi';

export type Place = {
  id: string;
  name: string;
  category: string;
  lon: number;
  lat: number;
  durationMin: number;
};

export type Stop = {
  id: string;
  placeId: string;
  name: string;
  category: string;
  lon: number;
  lat: number;
  durationMin: number;
  transportToNext: Transport;
  booking: string;
  fixedTime?: string;
  notes?: string;
};

export type Lodging = {
  name: string;
  checkIn: string;
  checkOut: string;
  note?: string;
};

export type Day = {
  id: string;
  date: string;
  label: string;
  title?: string;
  cityId?: AvailableCityId;
  startTime: string;
  stops: Stop[];
  lodging?: Lodging;
};

export type Trip = {
  id: string;
  cityId: AvailableCityId;
  title: string;
  startDate: string;
  days: Day[];
  activeDayId: string;
};

export type Theme = {
  paper: string;
  paperDeep: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  water: string;
  land: string;
  green: string;
  road: string;
  line: string;
  heroA: string;
  heroB: string;
};

export type Province = {
  id: string;
  name: string;
  short: string;
  theme: Theme;
  cityIds: CityId[];
};

export type FinePackInfo = {
  available: boolean;
  sizeBytes: number;
  version: string;
  maxzoom: number;
};

export type PackInfo = {
  id: CityId;
  provinceId: string;
  city: string;
  short: string;
  title: string;
  tagline: string;
  sizeBytes: number;
  version: string;
  available: boolean;
  downloadedByDefault: boolean;
  fine?: FinePackInfo;
};

export type LegRoute = {
  fromStopId: string;
  toStopId: string;
  mode: Transport;
  distanceM: number;
  durationMin: number;
  coordinates: [number, number][];
  ok: boolean;
};
