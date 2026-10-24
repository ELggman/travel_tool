import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { AvailableCityId, LegRoute, Stop, Theme } from '../data/types';
import { ensureTileUrls, getTileBlobUrl } from '../lib/tileStore';

type Props = {
  city: AvailableCityId;
  fine?: boolean;
  theme: Theme;
  stops: Stop[];
  legs: LegRoute[];
  activeStopId: string | null;
  onSelectStop: (id: string) => void;
};

export default function MapView({ city, fine = false, theme, stops, legs, activeStopId, onSelectStop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTilesReady(false);
    ensureTileUrls(city, fine ? 'fine' : 'standard')
      .then(() => { if (!cancelled) setTilesReady(true); })
      .catch((err) => console.error('[yanlu] tile cache unavailable', err));
    return () => { cancelled = true; };
  }, [city, fine]);

  useEffect(() => {
    if (!containerRef.current || !tilesReady) return;
    loadedRef.current = false;
    setReady(false);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {
          base: {
            type: 'vector',
            tiles: [`https://yanlu.local/packs/${city}${fine ? '-fine' : ''}/tiles/{z}/{x}/{y}.mvt`],
            minzoom: 0,
            maxzoom: fine ? 16 : 15,
            attribution: '© OpenStreetMap contributors · Protomaps',
          },
          route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': theme.paper } },
          { id: 'earth', type: 'fill', source: 'base', 'source-layer': 'earth', paint: { 'fill-color': theme.land } },
          { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': theme.water } },
          {
            id: 'landuse', type: 'fill', source: 'base', 'source-layer': 'landuse',
            paint: {
              'fill-color': ['match', ['get', 'kind'],
                'park', theme.green, 'grass', theme.green, 'forest', theme.green,
                'pedestrian', theme.paperDeep, 'residential', theme.land,
                'commercial', theme.paperDeep, 'pitch', theme.paperDeep, theme.land],
              'fill-opacity': 0.92,
            },
          },
          {
            id: 'buildings', type: 'fill', source: 'base', 'source-layer': 'buildings', minzoom: 13,
            paint: { 'fill-color': theme.paperDeep, 'fill-outline-color': theme.line, 'fill-opacity': 0.62 },
          },
          {
            id: 'roads-casing', type: 'line', source: 'base', 'source-layer': 'roads',
            paint: {
              'line-color': theme.line,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 2, 15, 6, 17, 11],
              'line-opacity': 0.8,
            },
          },
          {
            id: 'roads', type: 'line', source: 'base', 'source-layer': 'roads',
            paint: {
              'line-color': theme.road,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 1.2, 15, 4.2, 17, 8],
            },
          },
          {
            id: 'place-labels', type: 'symbol', source: 'base', 'source-layer': 'places',
            minzoom: 9,
            filter: ['all', ['has', 'name'], ['match', ['get', 'kind'],
              ['locality', 'neighbourhood', 'region', 'city', 'county', 'macrohood'], true, false],
              ['>=', ['zoom'], ['to-number', ['get', 'min_zoom']]]],
            layout: {
              'text-field': ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']],
              'text-font': ['NotoSansSC'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 13, 11, 16, 13],
              'text-letter-spacing': 0.02,
              'text-max-width': 8,
              'text-padding': 6,
              'text-offset': [0, -0.8],
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': theme.ink,
              'text-halo-color': theme.paper,
              'text-halo-width': 1.4,
              'text-halo-blur': 0.3,
            },
          },
          {
            id: 'road-labels', type: 'symbol', source: 'base', 'source-layer': 'roads',
            minzoom: 13,
            filter: ['all', ['has', 'name'], ['match', ['get', 'kind'],
              ['major_road', 'minor_road', 'highway'], true, false],
              ['>=', ['zoom'], ['to-number', ['get', 'min_zoom']]]],
            layout: {
              'symbol-placement': 'line',
              'text-field': ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']],
              'text-font': ['NotoSansSC'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 13, 8.5, 15, 10, 17, 12],
              'symbol-spacing': 260,
              'text-max-angle': 30,
              'text-padding': 2,
              'text-keep-upright': true,
            },
            paint: {
              'text-color': theme.muted,
              'text-halo-color': theme.paper,
              'text-halo-width': 1.2,
              'text-halo-blur': 0.2,
            },
          },
          {
            id: 'poi-labels', type: 'symbol', source: 'base', 'source-layer': 'pois',
            minzoom: 14,
            filter: ['all', ['has', 'name'], ['match', ['get', 'kind'],
              ['hospital', 'school', 'university', 'college', 'park', 'museum', 'attraction',
                'peak', 'station', 'subway_station', 'bus_station', 'ferry_terminal', 'aerodrome',
                'place_of_worship', 'library', 'theatre', 'zoo', 'stadium', 'theme_park',
                'marketplace', 'townhall', 'monument', 'memorial', 'viewpoint', 'mall', 'hotel'], true, false],
              ['>=', ['zoom'], ['to-number', ['get', 'min_zoom']]]],
            layout: {
              'text-field': ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']],
              'text-font': ['NotoSansSC'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 16, 11.5],
              'text-max-width': 8,
              'text-padding': 4,
              'text-optional': true,
              'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
              'text-radial-offset': 0.7,
              'text-justify': 'auto',
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': theme.ink,
              'text-halo-color': theme.paper,
              'text-halo-width': 1.3,
              'text-halo-blur': 0.25,
            },
          },
          {
            id: 'route-casing', type: 'line', source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#FFF9EE', 'line-width': 7, 'line-opacity': 0.9 },
          },
          {
            id: 'route-walk', type: 'line', source: 'route',
            filter: ['==', ['get', 'mode'], 'walk'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': theme.accent, 'line-width': 3.7 },
          },
          {
            id: 'route-taxi', type: 'line', source: 'route',
            filter: ['==', ['get', 'mode'], 'taxi'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': theme.accent2, 'line-width': 3.2, 'line-dasharray': [2, 1.4] },
          },
        ],
      },
      center: stops[0] ? [stops[0].lon, stops[0].lat] : [106.55, 29.56],
      zoom: 12,
      localIdeographFontFamily: "'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Microsoft YaHei',sans-serif",
      attributionControl: false,
    });
    mapRef.current = map;
    map.setTransformRequest((url) => {
      if (url.startsWith('https://yanlu.local/')) {
        const path = new URL(url).pathname;
        const blob = getTileBlobUrl(city, path, fine ? 'fine' : 'standard');
        if (blob) return { url: blob };
      }
      return { url };
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    map.on('load', () => {
      loadedRef.current = true;
      setReady(true);
      fit(map, stops, legs);
    });
    map.on('error', (event) => {
      console.error('[yanlu] map error', event.error?.message ?? event.error);
    });
    return () => {
      ro.disconnect();
      ((map as any)._yanluMarkers ?? []).forEach((m: maplibregl.Marker) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // map is recreated when the city or its downloaded tiles change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, fine, tilesReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !ready) return;
    sync(map, stops, legs, activeStopId, onSelectStop, theme);
  }, [stops, legs, activeStopId, theme, onSelectStop, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !ready) return;
    fit(map, stops, legs);
  }, [stops, legs, ready]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="map-credit">© OpenStreetMap · Protomaps · local pack</div>
    </div>
  );
}

function sync(
  map: maplibregl.Map,
  stops: Stop[],
  legs: LegRoute[],
  activeStopId: string | null,
  onSelectStop: (id: string) => void,
  theme: Theme,
) {
  const source = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: legs.map((leg) => ({
        type: 'Feature',
        properties: { mode: leg.mode },
        geometry: { type: 'LineString', coordinates: leg.coordinates },
      })),
    });
  }
  map.setPaintProperty('route-walk', 'line-color', theme.accent);
  map.setPaintProperty('route-taxi', 'line-color', theme.accent2);

  // remove old stop markers
  (map as any)._yanluMarkers?.forEach((m: maplibregl.Marker) => m.remove());
  const markers: maplibregl.Marker[] = [];
  stops.forEach((stop, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `map-stop${stop.id === activeStopId ? ' active' : ''}`;
    el.innerHTML = `<span>${i + 1}</span><b>${escapeHtml(stop.name)}</b>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelectStop(stop.id);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] })
      .setLngLat([stop.lon, stop.lat])
      .addTo(map);
    markers.push(marker);
  });
  (map as any)._yanluMarkers = markers;
}

function fit(map: maplibregl.Map, stops: Stop[], legs: LegRoute[]) {
  const coords: [number, number][] = [];
  legs.forEach((l) => coords.push(...l.coordinates));
  if (!coords.length) stops.forEach((s) => coords.push([s.lon, s.lat]));
  if (!coords.length) return;
  if (coords.length === 1) {
    map.jumpTo({ center: coords[0], zoom: 14 });
    return;
  }
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: { top: 60, right: 52, bottom: 60, left: 52 }, duration: 0, maxZoom: 14.6 });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
