/** Geographic OSM extraction for a whole selected area, independently of a route. */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { AtlasClass } from './core';
import { atlasFetch } from './atlasFetch';
import { atlasBoundsKey, validAtlasBounds, type AtlasBounds } from './atlasGeometry';
import { classify, clipLine, joinLines, TILEJSON_URL, type OsmFeature } from './osm';

export interface AtlasOsmFeature {
  cls: AtlasClass;
  label: string;
  lats: number[];
  lons: number[];
  /** Smaller ranks label larger places first. */
  rank?: number;
  /** Road importance: motorway 0, trunk 1, primary 2, secondary 3, tertiary 4, local 5, service 6. */
  roadRank?: number;
}
export interface AtlasOsmData {
  features: AtlasOsmFeature[];
  zoom: number;
  tiles: number;
}
export interface AtlasProgress {
  phase: 'download' | 'compile';
  done: number;
  total: number;
}

const TILE_LIMIT = 256;
const DOWNLOAD_LIMIT = 50_000_000;
const POINT_LIMIT = 300_000;
const PARALLEL = 4;

const ascii = (name: unknown) => String(name ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, 24);
const WATER = new Set(['river', 'lake', 'stream']);
export const isAtlasWater = (cls: AtlasClass) => WATER.has(cls);

/** Keep the road hierarchy separate from the corridor's coarser classification. */
const ROAD_RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, minor: 5, service: 6 };
export function atlasRoadTier(feature: AtlasOsmFeature): number | undefined {
  if (feature.cls === 'road') return 0;
  if (feature.cls === 'minor') return (feature.roadRank ?? 3) <= 4 ? 1 : 2;
  return undefined;
}

/** Number of tile coordinates, without allocating a huge array for a continental selection. */
export function atlasTileRange(bounds: AtlasBounds, zoom: number) {
  if (!validAtlasBounds(bounds)) throw new Error('Zone cartographique invalide.');
  const n = 2 ** zoom;
  const x = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
  const y = (lat: number) => Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
  const west = x(bounds[0]), east = x(bounds[2]), north = y(bounds[3]), south = y(bounds[1]);
  return { west, east, north, south, count: (east - west + 1) * (south - north + 1) };
}

export function atlasSourceZoom(bounds: AtlasBounds): number {
  for (let z = 14; z >= 0; z--) if (atlasTileRange(bounds, z).count <= TILE_LIMIT) return z;
  return 0;
}

/** Read additional atlas-only layers and real water outlines, omitting artificial tile-edge segments. */
export function readAtlasTile(bytes: Uint8Array, x: number, y: number, z: number): AtlasOsmFeature[] {
  const out: AtlasOsmFeature[] = [];
  const tile = new VectorTile(new PbfReader(bytes));
  const n = 2 ** z;
  for (const name of ['transportation', 'waterway', 'place', 'boundary', 'water']) {
    const layer = tile.layers[name];
    if (!layer) continue;
    const lon = (px: number) => (x + px / layer.extent) / n * 360 - 180;
    const lat = (py: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / layer.extent) / n))) * 180 / Math.PI;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i), p = f.properties;
      if (name === 'transportation' || name === 'waterway') {
        if (f.type !== 2) continue;
        const roadRank = name === 'transportation' ? ROAD_RANK[String(p.class)] : undefined;
        const way = classify(name, p);
        const cls = roadRank !== undefined ? (roadRank <= 2 ? 'road' : 'minor')
          : way === 'path' || way === 'track' || way === 'river' || way === 'stream' ? way : undefined;
        if (!cls) continue;
        for (const part of f.loadGeometry().flatMap((line) => clipLine(line, layer.extent))) {
          if (part.length > 1) out.push({ cls, roadRank, label: '', lats: part.map((q) => lat(q.y)), lons: part.map((q) => lon(q.x)) });
        }
      } else if (name === 'place') {
        const classes = ['city', 'town', 'village', 'hamlet'];
        const priority = classes.indexOf(String(p.class));
        if (priority < 0 || f.type !== 1) continue;
        const point = f.loadGeometry()[0]?.[0];
        const label = ascii(p['name:latin'] ?? p['name:fr'] ?? p.name);
        if (point && label) out.push({ cls: 'city', label, lats: [lat(point.y)], lons: [lon(point.x)], rank: priority * 100 + Number(p.rank || 0) });
      } else if (name === 'boundary') {
        const admin = Number(p.admin_level);
        if (f.type !== 2 || Number(p.maritime) === 1 || (admin !== 2 && admin !== 6)) continue;
        for (const part of f.loadGeometry().flatMap((line) => clipLine(line, layer.extent))) {
          if (part.length > 1) out.push({ cls: admin === 2 ? 'boundary' : 'department', label: '', lats: part.map((q) => lat(q.y)), lons: part.map((q) => lon(q.x)) });
        }
      } else {
        if (f.type !== 3 || p.class === 'swimming_pool') continue;
        for (const ring of f.loadGeometry()) {
          let run: typeof ring = [];
          const flush = () => {
            for (const part of clipLine(run, layer.extent)) if (part.length > 1) out.push({ cls: p.class === 'ocean' ? 'boundary' : 'lake', label: '', lats: part.map((q) => lat(q.y)), lons: part.map((q) => lon(q.x)) });
            run = [];
          };
          for (let j = 1; j < ring.length; j++) {
            const a = ring[j - 1], b = ring[j];
            if ((a.x <= 0 && b.x <= 0) || (a.x >= layer.extent && b.x >= layer.extent) ||
                (a.y <= 0 && b.y <= 0) || (a.y >= layer.extent && b.y >= layer.extent)) { flush(); continue; }
            if (!run.length) run.push(a);
            run.push(b);
          }
          flush();
        }
      }
    }
  }
  return out;
}

class DenseSource extends Error {}
const SOURCE_FILTERS: ((f: AtlasOsmFeature) => boolean)[] = [
  (f) => atlasRoadTier(f) !== 2 && f.cls !== 'path' && f.cls !== 'track' && f.cls !== 'stream',
  (f) => f.cls !== 'lake',
  (f) => f.cls !== 'river',
  (f) => f.cls !== 'department',
  (f) => f.cls !== 'city' || (f.rank ?? 999) < 200,
];
function intersectsArea(f: AtlasOsmFeature, bounds: AtlasBounds): boolean {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (let i = 0; i < f.lats.length; i++) {
    west = Math.min(west, f.lons[i]); east = Math.max(east, f.lons[i]);
    south = Math.min(south, f.lats[i]); north = Math.max(north, f.lats[i]);
  }
  return west <= bounds[2] && east >= bounds[0] && south <= bounds[3] && north >= bounds[1];
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error('Préparation annulée.'), { name: 'AbortError' });
}
let cached: { key: string; data: AtlasOsmData } | undefined;

/** Fetch one bounded source, then reuse it when contents or the device budget change. */
async function downloadAtlasOsm(
  bounds: AtlasBounds,
  options: { get?: typeof fetch; signal?: AbortSignal; onProgress?: (progress: AtlasProgress) => void } = {},
): Promise<AtlasOsmData> {
  if (!validAtlasBounds(bounds)) throw new Error('Zone cartographique invalide.');
  const key = atlasBoundsKey(bounds);
  checkAbort(options.signal);
  if (!options.get && cached?.key === key) return cached.data;
  const get = options.get ?? atlasFetch;
  const metadata = await get(TILEJSON_URL, { signal: options.signal });
  if (!metadata.ok) throw new Error('Le serveur de cartes est injoignable.');
  const template = ((await metadata.json()) as { tiles?: string[] }).tiles?.[0];
  if (!template) throw new Error('Le serveur ne fournit pas ses données cartographiques.');
  let downloaded = 0;
  for (let zoom = atlasSourceZoom(bounds); zoom >= 0; zoom--) {
    const range = atlasTileRange(bounds, zoom);
    const wanted: { x: number; y: number }[] = [];
    for (let x = range.west; x <= range.east; x++) for (let y = range.north; y <= range.south; y++) wanted.push({ x, y });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const signal = controller.signal;
    const read: AtlasOsmFeature[][] = new Array(wanted.length);
    let next = 0, done = 0, points = 0, sourceDetail = 0;
    const keep = (f: AtlasOsmFeature) => SOURCE_FILTERS.slice(0, sourceDetail).every((filter) => filter(f));
    const worker = async () => {
      while (next < wanted.length) {
        checkAbort(signal);
        const index = next++, { x, y } = wanted[index];
        const url = template.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
        const res = await get(url, { signal });
        if (res.status === 204 || res.status === 404) read[index] = [];
        else {
          if (!res.ok) throw new Error(`Le serveur de cartes a répondu ${res.status}.`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          downloaded += bytes.length;
          if (downloaded > DOWNLOAD_LIMIT) throw new Error('Cette zone demande trop de données. Choisissez une zone plus petite.');
          read[index] = readAtlasTile(bytes, x, y, zoom).filter((f) => intersectsArea(f, bounds) && keep(f));
          points += read[index].reduce((sum, f) => sum + f.lats.length, 0);
          // Keep the source zoom that contains secondary roads. Shed less
          // important layers before stepping down to tiles with no such roads.
          while (points > POINT_LIMIT && sourceDetail < SOURCE_FILTERS.length) {
            sourceDetail++;
            points = 0;
            for (let i = 0; i < read.length; i++) {
              if (!read[i]) continue;
              read[i] = read[i].filter(keep);
              points += read[i].reduce((sum, f) => sum + f.lats.length, 0);
            }
          }
          if (points > POINT_LIMIT) throw new DenseSource();
        }
        options.onProgress?.({ phase: 'download', done: ++done, total: wanted.length });
      }
    };
    const workers = Array.from({ length: Math.min(PARALLEL, wanted.length) }, worker);
    try {
      await Promise.all(workers);
      checkAbort(options.signal);
      const features = mergeFeatures(read.flat(), bounds);
      const data = { features, zoom, tiles: wanted.length };
      if (!options.get) cached = { key, data };
      return data;
    } catch (e) {
      controller.abort();
      await Promise.allSettled(workers);
      checkAbort(options.signal);
      if (e instanceof DenseSource && zoom > 0) continue;
      throw e;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  throw new Error('Impossible de préparer cette zone.');
}

function mergeFeatures(features: AtlasOsmFeature[], bounds: AtlasBounds): AtlasOsmFeature[] {
  const result: AtlasOsmFeature[] = [];
  const cls: Record<string, OsmFeature['cls']> = { road: 'major', minor: 'minor', path: 'path', track: 'track', river: 'river', stream: 'stream', lake: 'river', boundary: 'major', department: 'major' };
  for (const kind of Object.keys(cls) as AtlasClass[]) {
    const members = features.filter((f) => f.cls === kind);
    // Joining different ranks would lose which roads may be dropped first.
    for (const roadRank of new Set(members.map((f) => f.roadRank))) {
      const lines = members.filter((f) => f.roadRank === roadRank).map((f) => ({ ...f, cls: cls[kind] }));
      for (const f of joinLines(lines)) result.push({ ...f, cls: kind, roadRank, label: '' });
    }
  }
  const seen = new Set<string>();
  for (const f of features.filter((f) => f.cls === 'city').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))) {
    const x = f.lons[0], y = f.lats[0];
    const key = `${f.label}:${x.toFixed(4)}:${y.toFixed(4)}`;
    if (seen.has(key) || x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]) continue;
    seen.add(key); result.push(f);
  }
  return result;
}

/** A cancelled preparation stays silent; provider failures have an app-facing message. */
export async function fetchAtlasOsm(
  bounds: AtlasBounds,
  options: Parameters<typeof downloadAtlasOsm>[1] = {},
): Promise<AtlasOsmData> {
  try { return await downloadAtlasOsm(bounds, options); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Lecture des données cartographiques impossible : ${reason}`);
  }
}
