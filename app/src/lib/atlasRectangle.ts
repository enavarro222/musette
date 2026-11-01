import type { Feature, Polygon } from 'geojson';
import type { FillLayerSpecification, LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { AtlasBounds } from './atlasGeometry';

export const ATLAS_HANDLES = [
  { id: 'nw', label: 'Coin nord-ouest', cursor: 'nwse-resize' },
  { id: 'ne', label: 'Coin nord-est', cursor: 'nesw-resize' },
  { id: 'se', label: 'Coin sud-est', cursor: 'nwse-resize' },
  { id: 'sw', label: 'Coin sud-ouest', cursor: 'nesw-resize' },
  { id: 'move', label: 'Déplacer la zone', cursor: 'move' },
] as const;
export type AtlasHandle = typeof ATLAS_HANDLES[number]['id'];

export function atlasHandlePosition([w, s, e, n]: AtlasBounds, handle: AtlasHandle): [number, number] {
  switch (handle) {
    case 'nw': return [w, n];
    case 'ne': return [e, n];
    case 'se': return [e, s];
    case 'sw': return [w, s];
    case 'move': return [(w + e) / 2, (s + n) / 2];
  }
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Resize with the opposite corner fixed, or translate without changing either span. */
export function dragAtlasRectangle(bounds: AtlasBounds, handle: AtlasHandle, [lon, lat]: [number, number]): AtlasBounds {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return bounds;
  const [w, s, e, n] = bounds;
  if (handle === 'move') {
    const hw = (e - w) / 2, hh = (n - s) / 2;
    const x = clamp(lon, -180 + hw, 180 - hw), y = clamp(lat, -85 + hh, 85 - hh);
    return [x - hw, y - hh, x + hw, y + hh];
  }
  // Leave a valid non-zero selection even when a handle is dragged past its opposite corner.
  const span = 0.0002;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  return [west ? clamp(lon, -180, e - span) : w, north ? s : clamp(lat, -85, n - span),
    west ? e : clamp(lon, w + span, 180), north ? clamp(lat, s + span, 85) : n];
}

export function atlasRectangle([w, s, e, n]: AtlasBounds): Feature<Polygon> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] } };
}

export const ATLAS_AREA_LAYERS: (Omit<FillLayerSpecification, 'source'> | Omit<LineLayerSpecification, 'source'>)[] = [
  { id: 'atlas-area-fill', type: 'fill', paint: { 'fill-color': '#0B6E69', 'fill-opacity': 0.12 } },
  { id: 'atlas-area-outline', type: 'line', paint: { 'line-color': '#0B6E69', 'line-width': 3 } },
];
