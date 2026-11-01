import type { FeatureCollection, Feature, LineString, Point } from 'geojson';
import type { CircleLayerSpecification, LineLayerSpecification, StyleSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { loadCore } from './core';
import type { AtlasBounds } from './atlasGeometry';

export interface AtlasPreviewData {
  name: string;
  bounds: AtlasBounds;
  levels: FeatureCollection[];
}

/** Decode the final transfer bytes, including clipping, quantisation and all three stored levels. */
export async function atlasPreviewData(bytes: Uint8Array, bounds: AtlasBounds): Promise<AtlasPreviewData> {
  const preview = (await loadCore()).cc600AtlasPreview(bytes);
  const levels = preview.levels.map((level): FeatureCollection => {
    let at = 0;
    const features: Feature<LineString | Point>[] = level.classes.map((kind, i) => {
      const coordinates: [number, number][] = [];
      for (let j = 0; j < level.lengths[i]; j++, at++) coordinates.push([level.lons[at], level.lats[at]]);
      return { type: 'Feature', properties: { kind, label: level.labels[i], priority: i },
        geometry: kind === 'city' ? { type: 'Point', coordinates: coordinates[0] } : { type: 'LineString', coordinates } };
    });
    return { type: 'FeatureCollection', features };
  });
  return { name: preview.name, bounds, levels };
}

/** Same three geographic simplification bands as the device, expressed at MapLibre's current scale. */
export function atlasPreviewLevel(zoom: number, latitude: number): number {
  const metresPerPixel = 40_075_016.686 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
  return metresPerPixel < 800 ? 0 : metresPerPixel < 4000 ? 1 : 2;
}

/** Empty background: every geographic element will come from the prepared file. */
export function atlasPreviewStyle(dark: boolean) {
  return { version: 8, sources: {}, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#18211F' : '#F6F5EF' } }] } satisfies StyleSpecification;
}

type PreviewLayer = Omit<LineLayerSpecification, 'source'> | Omit<CircleLayerSpecification, 'source'> | Omit<SymbolLayerSpecification, 'source'>;
export function atlasPreviewLayers(dark: boolean): PreviewLayer[] {
  const muted = dark ? '#9AA9A2' : '#65746D';
  const minor = dark ? '#89968F' : '#9BA49D';
  const water = dark ? '#5297BE' : '#78AFCB';
  return [
    { id: 'atlas-water', type: 'line', filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'lake']]], paint: { 'line-color': water, 'line-width': 1.2 } },
    { id: 'atlas-boundary', type: 'line', filter: ['==', ['get', 'kind'], 'boundary'], paint: { 'line-color': muted, 'line-width': 1 } },
    { id: 'atlas-department', type: 'line', filter: ['==', ['get', 'kind'], 'department'], paint: { 'line-color': muted, 'line-width': 1, 'line-dasharray': [3, 3] } },
    { id: 'atlas-path', type: 'line', filter: ['in', ['get', 'kind'], ['literal', ['path', 'track']]], paint: { 'line-color': minor, 'line-width': 1, 'line-dasharray': [2, 2] } },
    { id: 'atlas-minor', type: 'line', filter: ['==', ['get', 'kind'], 'minor'], paint: { 'line-color': minor, 'line-width': 1.2 } },
    { id: 'atlas-road', type: 'line', filter: ['==', ['get', 'kind'], 'road'], paint: { 'line-color': dark ? '#D3B87D' : '#AC8E51', 'line-width': 1.8 } },
    { id: 'atlas-places', type: 'circle', filter: ['==', ['get', 'kind'], 'city'], paint: { 'circle-color': muted, 'circle-radius': 2 } },
    { id: 'atlas-labels', type: 'symbol', filter: ['==', ['get', 'kind'], 'city'],
      layout: { 'text-field': ['get', 'label'], 'text-transform': 'uppercase', 'text-font': ['Noto Sans Regular'], 'text-size': 11,
        'text-anchor': 'left', 'text-offset': [0.4, 0], 'symbol-sort-key': ['get', 'priority'] },
      paint: { 'text-color': muted, 'text-halo-color': dark ? '#18211F' : '#F6F5EF', 'text-halo-width': 1.5 } },
  ];
}
