import type { CircleLayerSpecification, LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection } from 'geojson';
import type { ParsedRoute, RouteAnalysis } from './core';
import { theme } from '../theme';

/**
 * What the route map shows, the same on every platform (`RouteMap.tsx`,
 * `RouteMap.web.tsx` draw it): the route, its climbs over it, start and
 * finish, and the area to fit.
 */
export interface RouteMapData {
  /** West, south, east, north. */
  bounds: [number, number, number, number];
  features: FeatureCollection;
}

type Kind = 'route' | 'climb' | 'start' | 'finish';

const line = (kind: Kind, coordinates: number[][]): Feature => ({
  type: 'Feature',
  properties: { kind },
  geometry: { type: 'LineString', coordinates },
});

const point = (kind: Kind, coordinates: number[]): Feature => ({
  type: 'Feature',
  properties: { kind },
  geometry: { type: 'Point', coordinates },
});

/** Undefined for a route without two points. Uses the simplified points: enough for a map, and light. */
export function routeMapData(route: ParsedRoute, analysis: RouteAnalysis): RouteMapData | undefined {
  const coords = analysis.simplified.map((i) => [route.lons[i], route.lats[i]]);
  if (coords.length < 2) return undefined;
  const at = analysis.simplifiedM;
  const climbs = analysis.climbs.map((c) => {
    // The points within the climb, and the one each side so the line reaches its ends.
    const first = Math.max(0, at.findIndex((m) => m >= c.startM) - 1);
    const after = at.findIndex((m) => m > c.endM);
    return line('climb', coords.slice(first, after < 0 ? coords.length : after + 1));
  });
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    features: {
      type: 'FeatureCollection',
      features: [line('route', coords), ...climbs, point('start', coords[0]), point('finish', coords[coords.length - 1])],
    },
  };
}

/** Room around the route when fitting it; more at the bottom, where the attribution sits. */
export const FIT_PADDING = { top: 24, right: 24, bottom: 44, left: 24 };

/** OpenFreeMap: OpenStreetMap data, free, no key. Its styles carry the attribution. */
export const MAP_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** The map's layers over the source `route` (MapLibre style spec, used as is on every platform). */
export const ROUTE_LAYERS: (Omit<LineLayerSpecification, 'source'> | Omit<CircleLayerSpecification, 'source'>)[] = [
  {
    id: 'route',
    type: 'line',
    filter: ['==', ['get', 'kind'], 'route'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': theme.accent, 'line-width': 4 },
  },
  {
    id: 'climbs',
    type: 'line',
    filter: ['==', ['get', 'kind'], 'climb'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': theme.climbLine, 'line-width': 5 },
  },
  {
    id: 'ends',
    type: 'circle',
    filter: ['in', ['get', 'kind'], ['literal', ['start', 'finish']]],
    paint: {
      'circle-radius': 6,
      'circle-color': ['match', ['get', 'kind'], 'start', theme.accent, '#ffffff'],
      'circle-stroke-color': theme.accent,
      'circle-stroke-width': 3,
    },
  },
];
