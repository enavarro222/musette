/**
 * The OpenStreetMap features around a route, as the classes a background map
 * draws: from vector tiles (OpenMapTiles schema, zoom 14), the ones the
 * app's maps show (OpenFreeMap). Musette's backend can later serve the same
 * tiles (PMTiles).
 */
import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { MapClass, MapFeatures } from './core';

/** One line, or the outer ring of an area. */
export interface OsmFeature {
  cls: MapClass;
  lats: number[];
  lons: number[];
}

/** The tiles' TileJSON: it names the current tiles. */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

/** The most detailed tiles: paths, tracks and services are only there. */
export const TILE_ZOOM = 14;

const ROADS: Record<string, MapClass> = {
  motorway: 'major',
  trunk: 'major',
  primary: 'major',
  secondary: 'major',
  tertiary: 'minor',
  minor: 'minor',
  service: 'service',
  track: 'track',
  path: 'path',
};

/** The class of a tile feature from its layer and properties (OpenMapTiles); undefined: not drawn. */
export function classify(layer: string, p: Record<string, unknown>): MapClass | undefined {
  switch (layer) {
    case 'transportation':
      return typeof p.class === 'string' ? ROADS[p.class] : undefined;
    case 'waterway':
      if (p.class === 'river' || p.class === 'canal') return 'river';
      if (p.class === 'stream' || p.class === 'ditch' || p.class === 'drain') return 'stream';
      return undefined;
    case 'water':
      return p.class === 'swimming_pool' ? undefined : 'water';
    case 'landcover':
      return p.class === 'wood' ? 'forest' : undefined;
    case 'landuse':
      return p.class === 'residential' ? 'residential' : undefined;
    default:
      return undefined;
  }
}

const LAYERS = ['transportation', 'waterway', 'water', 'landcover', 'landuse'];

type Pt = { x: number; y: number };

/**
 * A line cut to the square [0, e]²: the runs inside. Tiles carry a margin
 * past their edges, cut off so that a feature next to an edge is not kept
 * twice, by both tiles.
 */
export function clipLine(line: Pt[], e: number): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    // Liang-Barsky: the part of segment a-b inside
    let [t0, t1] = [0, 1];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const inside = [
      [-dx, a.x],
      [dx, e - a.x],
      [-dy, a.y],
      [dy, e - a.y],
    ].every(([p, q]) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      return t0 <= t1;
    });
    if (!inside) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    const from = { x: a.x + t0 * dx, y: a.y + t0 * dy };
    const to = { x: a.x + t1 * dx, y: a.y + t1 * dy };
    if (run.length === 0 || t0 > 0) {
      if (run.length > 1) runs.push(run);
      run = [from];
    }
    run.push(to);
    if (t1 < 1) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** A ring cut to the square [0, e]² (Sutherland-Hodgman): the area inside, closed; empty when none. */
export function clipRing(ring: Pt[], e: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= e, (a, b) => ({ x: e, y: a.y + ((b.y - a.y) * (e - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= e, (a, b) => ({ x: a.x + ((b.x - a.x) * (e - a.y)) / (b.y - a.y), y: e })],
  ];
  let out = ring.slice(0, -1);
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    input.forEach((b, i) => {
      const a = input[(i + input.length - 1) % input.length];
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cross(a, b));
    });
    if (out.length === 0) return [];
  }
  return out.length < 3 ? [] : [...out, out[0]];
}

/** The features of tile `z/x/y`, cut to the tile: lines, and the outer rings of areas (holes left out). */
export function readTile(bytes: Uint8Array, x: number, y: number, z: number): OsmFeature[] {
  const tile = new VectorTile(new PbfReader(bytes));
  const out: OsmFeature[] = [];
  const n = 2 ** z;
  for (const name of LAYERS) {
    const layer = tile.layers[name];
    if (!layer) continue;
    const lon = (px: number) => ((x + px / layer.extent) / n) * 360 - 180;
    const lat = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / layer.extent)) / n))) * 180) / Math.PI;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const cls = classify(name, f.properties);
      if (!cls || f.type === 1) continue;
      const geometry = f.loadGeometry();
      const parts =
        f.type === 3
          ? classifyRings(geometry).map((polygon) => clipRing(polygon[0], layer.extent))
          : geometry.flatMap((line) => clipLine(line, layer.extent));
      for (const part of parts) {
        if (part.length < 2) continue;
        out.push({ cls, lats: part.map((p) => lat(p.y)), lons: part.map((p) => lon(p.x)) });
      }
    }
  }
  return out;
}

/** The tiles at `z` within `radiusM` of points of a route ([lat, lon], at most a few hundred metres apart). */
export function tilesAround(points: [number, number][], radiusM: number, z = TILE_ZOOM): { x: number; y: number }[] {
  const n = 2 ** z;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const seen = new Map<string, { x: number; y: number }>();
  for (const [lat, lon] of points) {
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    for (let x = tx(lon - dLon); x <= tx(lon + dLon); x++) {
      for (let y = ty(lat + dLat); y <= ty(lat - dLat); y++) seen.set(`${x}/${y}`, { x, y });
    }
  }
  return [...seen.values()];
}

/** Tiles read this session: a route sent again, or with other options, fetches nothing. Failures are not kept. */
const tiles = new Map<string, Promise<OsmFeature[]>>();
let template: Promise<string> | undefined;

function tileUrl(get: typeof fetch): Promise<string> {
  if (!template) {
    const p = (async () => {
      const res = await get(TILEJSON_URL);
      if (!res.ok) throw new Error(`le serveur de cartes a répondu ${res.status}`);
      const url = ((await res.json()) as { tiles?: string[] }).tiles?.[0];
      if (!url) throw new Error('le serveur de cartes ne donne pas ses tuiles');
      return url;
    })();
    p.catch(() => (template = undefined));
    template = p;
  }
  return template;
}

function tile(url: string, x: number, y: number, get: typeof fetch): Promise<OsmFeature[]> {
  const src = url.replace('{z}', String(TILE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
  let p = tiles.get(src);
  if (!p) {
    p = (async () => {
      const res = await get(src);
      // no tile: nothing there (the sea)
      if (res.status === 204 || res.status === 404) return [];
      if (!res.ok) throw new Error(`le serveur de cartes a répondu ${res.status}`);
      return readTile(new Uint8Array(await res.arrayBuffer()), x, y, TILE_ZOOM);
    })();
    p.catch(() => tiles.delete(src));
    tiles.set(src, p);
  }
  return p;
}

/** Tiles fetched at once. */
const PARALLEL = 6;

/**
 * The features within `radiusM` of the line `points` ([lat, lon]), from the
 * vector tiles; `onProgress` gets the share of tiles read.
 */
export async function fetchOsmFeatures(
  points: [number, number][],
  radiusM: number,
  get: typeof fetch = (input, init) => fetch(input, init),
  onProgress?: (ratio: number) => void,
): Promise<OsmFeature[]> {
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let url: string;
  try {
    url = await tileUrl(get);
  } catch (e) {
    throw new Error(`Carte injoignable : ${reason(e)}.`);
  }
  const wanted = tilesAround(points, radiusM);
  const read: OsmFeature[][] = [];
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { x, y } = wanted[next++];
      read.push(await tile(url, x, y, get));
      onProgress?.(read.length / wanted.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, wanted.length) }, worker));
  } catch (e) {
    throw new Error(`Carte incomplète : ${reason(e)}.`);
  }
  return joinLines(read.flat());
}

/**
 * The lines cut by the tiles' edges joined again: a piece follows another of
 * the same class that ends where it starts. Both tiles compute a point of
 * their common edge the same way: the ends match exactly. Not by the tiles'
 * ids: a tile merges the ways of a road into one feature with one of their
 * ids, not the same in the next tile. Two roads of a class meeting end to
 * end are joined too: drawn the same, fewer bytes. Areas stay cut (joining
 * them means merging polygons, for a straight segment along the edge).
 */
export function joinLines(features: OsmFeature[]): OsmFeature[] {
  const AREAS: MapClass[] = ['forest', 'water', 'residential'];
  const end = (f: OsmFeature, i: number) => `${f.cls}:${f.lats.at(i)},${f.lons.at(i)}`;
  const starts = new Map<string, OsmFeature>();
  const ends = new Map<string, OsmFeature>();
  for (const f of features) {
    if (AREAS.includes(f.cls)) continue;
    starts.set(end(f, 0), f);
    ends.set(end(f, -1), f);
  }
  const joined = new Set<OsmFeature>();
  const out: OsmFeature[] = [];
  for (const f of features) {
    if (joined.has(f)) continue;
    if (AREAS.includes(f.cls)) {
      out.push(f);
      continue;
    }
    // from the first piece of a chain: the one no other piece leads to
    let first = f;
    const seen = new Set([f]);
    // not through a piece already joined (in another line from the same point): it would be there twice
    for (let prev = before(first); prev && !seen.has(prev) && !joined.has(prev); prev = before(first)) {
      seen.add(prev);
      first = prev;
    }
    // a copy: the pieces stay as their tile has them (kept for other routes)
    const line: OsmFeature = { ...first, lats: [...first.lats], lons: [...first.lons] };
    joined.add(first);
    for (let next = starts.get(end(first, -1)); next && !joined.has(next); next = starts.get(end(next, -1))) {
      line.lats.push(...next.lats.slice(1));
      line.lons.push(...next.lons.slice(1));
      joined.add(next);
    }
    out.push(line);
  }
  return out;

  function before(f: OsmFeature): OsmFeature | undefined {
    return ends.get(end(f, 0));
  }
}

/** Features as the core takes them: only the classes in `keep`. */
export function flatFeatures(features: OsmFeature[], keep: ReadonlySet<MapClass>): MapFeatures {
  const flat: MapFeatures = { classes: [], lengths: [], lats: [], lons: [] };
  for (const f of features) {
    if (!keep.has(f.cls)) continue;
    flat.classes.push(f.cls);
    flat.lengths.push(f.lats.length);
    // one by one: a forest's ring can be longer than a call's arguments
    for (let i = 0; i < f.lats.length; i++) {
      flat.lats.push(f.lats[i]);
      flat.lons.push(f.lons[i]);
    }
  }
  return flat;
}
