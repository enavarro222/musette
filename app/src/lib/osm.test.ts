import { PbfWriter } from 'pbf';
import { describe, expect, it } from 'vitest';
import { classify, clipLine, clipRing, fetchOsmFeatures, flatFeatures, joinLines, readTile, TILE_ZOOM, TILEJSON_URL, tilesAround, type OsmFeature } from './osm';

/** A feature of a test tile: type (2 line, 3 polygon), properties, rings in tile units. */
interface TestFeature {
  type: 2 | 3;
  props: Record<string, string>;
  rings: [number, number][][];
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/** A vector tile (MVT 2.1) with these layers, extent 4096. */
function mvt(layers: Record<string, TestFeature[]>): Uint8Array {
  const pbf = new PbfWriter();
  for (const [name, features] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: string[] = [];
    const index = (list: string[], v: string) => (list.includes(v) ? list.indexOf(v) : list.push(v) - 1);
    const encoded = features.map((f) => {
      const tags = Object.entries(f.props).flatMap(([k, v]) => [index(keys, k), index(values, v)]);
      const geometry: number[] = [];
      let [cx, cy] = [0, 0];
      for (const ring of f.rings) {
        const points = f.type === 3 ? ring.slice(0, -1) : ring;
        points.forEach(([x, y], i) => {
          if (i === 0) geometry.push(1 | (1 << 3));
          if (i === 1) geometry.push(2 | ((points.length - 1) << 3));
          geometry.push(zigzag(x - cx), zigzag(y - cy));
          [cx, cy] = [x, y];
        });
        if (f.type === 3) geometry.push(7 | (1 << 3));
      }
      return { type: f.type, tags, geometry };
    });
    pbf.writeMessage(
      3,
      (_: null, p: PbfWriter) => {
        p.writeVarintField(15, 2);
        p.writeStringField(1, name);
        for (const f of encoded) {
          p.writeMessage(
            2,
            (_: null, q: PbfWriter) => {
              q.writePackedVarint(2, f.tags);
              q.writeVarintField(3, f.type);
              q.writePackedVarint(4, f.geometry);
            },
            null,
          );
        }
        for (const k of keys) p.writeStringField(3, k);
        for (const v of values) p.writeMessage(4, (_: null, q: PbfWriter) => q.writeStringField(1, v), null);
        p.writeVarintField(5, 4096);
      },
      null,
    );
  }
  return pbf.finish();
}

describe('OSM features from vector tiles', () => {
  it('classifies OpenMapTiles features as the map draws them', () => {
    expect(classify('transportation', { class: 'primary' })).toBe('major');
    expect(classify('transportation', { class: 'minor' })).toBe('minor');
    expect(classify('transportation', { class: 'path', subclass: 'cycleway' })).toBe('path');
    expect(classify('transportation', { class: 'rail' })).toBeUndefined();
    expect(classify('waterway', { class: 'canal' })).toBe('river');
    expect(classify('water', { class: 'lake' })).toBe('water');
    expect(classify('water', { class: 'swimming_pool' })).toBeUndefined();
    expect(classify('landcover', { class: 'wood', subclass: 'forest' })).toBe('forest');
    expect(classify('landcover', { class: 'farmland' })).toBeUndefined();
    expect(classify('landuse', { class: 'residential' })).toBe('residential');
    expect(classify('building', {})).toBeUndefined();
  });

  it('reads lines and the outer rings of areas, in degrees', () => {
    const square = (a: number, b: number): [number, number][] => [[a, a], [b, a], [b, b], [a, b], [a, a]];
    const bytes = mvt({
      transportation: [
        { type: 2, props: { class: 'track' }, rings: [[[0, 0], [4096, 4096]]] },
        { type: 2, props: { class: 'rail' }, rings: [[[0, 0], [10, 10]]] },
      ],
      // a wood with a clearing: the hole is left out
      landcover: [{ type: 3, props: { class: 'wood' }, rings: [square(0, 2048), square(512, 1024).reverse()] }],
    });
    const [x, y, z] = [8271, 5960, TILE_ZOOM];
    const features = readTile(bytes, x, y, z);
    expect(features.map((f) => [f.cls, f.lats.length])).toEqual([
      ['track', 2],
      ['forest', 5],
    ]);
    const track = features[0];
    // the tile's corners
    expect(track.lons[0]).toBeCloseTo((x / 2 ** z) * 360 - 180, 9);
    expect(track.lons[1]).toBeCloseTo(((x + 1) / 2 ** z) * 360 - 180, 9);
    expect(track.lats[0]).toBeGreaterThan(track.lats[1]);
    const flat = flatFeatures(features, new Set(['forest']));
    expect(flat.classes).toEqual(['forest']);
    expect(flat.lengths).toEqual([5]);
  });

  it('keeps only what is inside the tile: its margin belongs to the next tile', () => {
    const p = (x: number, y: number) => ({ x, y });
    // in, out past the right edge, back in
    expect(clipLine([p(10, 10), p(110, 10), p(110, 50), p(10, 50)], 100)).toEqual([
      [p(10, 10), p(100, 10)],
      [p(100, 50), p(10, 50)],
    ]);
    expect(clipLine([p(-50, 10), p(-10, 10)], 100)).toEqual([]);
    // a square across the left edge: the half inside, closed
    const half = clipRing([p(-50, 10), p(50, 10), p(50, 60), p(-50, 60), p(-50, 10)], 100);
    expect(half.at(0)).toEqual(half.at(-1));
    expect(Math.min(...half.map((q) => q.x))).toBe(0);
    expect(half).toHaveLength(5);
    expect(clipRing([p(-50, 10), p(-10, 10), p(-10, 60), p(-50, 10)], 100)).toEqual([]);

    // a road through the margin, a wood all in it: the road stops at the edge, the wood is the next tile's
    const bytes = mvt({
      transportation: [{ type: 2, props: { class: 'minor' }, rings: [[[2048, 2048], [4200, 2048]]] }],
      landcover: [{ type: 3, props: { class: 'wood' }, rings: [[[4100, 0], [4150, 0], [4150, 50], [4100, 0]]] }],
    });
    const [road, ...rest] = readTile(bytes, 8271, 5960, TILE_ZOOM);
    expect(rest).toEqual([]);
    expect(road.lons[1]).toBeCloseTo((8272 / 2 ** TILE_ZOOM) * 360 - 180, 9);
  });

  it('joins the pieces of a line cut by the tiles, in order', () => {
    const piece = (lons: number[], cls: OsmFeature['cls'] = 'minor'): OsmFeature => ({
      cls,
      lats: lons.map(() => 44),
      lons,
    });
    const joined = joinLines([
      piece([3, 4]), // the middle piece first: tiles come in any order
      piece([4, 5, 6]),
      piece([1, 2, 3]),
      piece([9, 10]), // back in the corridor further on: a line of its own
      piece([6, 7], 'path'), // a path from the same point: another class
      piece([0, 1], 'forest'), // areas stay as they are
      piece([1, 2], 'forest'),
    ]);
    // two pieces start where a joined line passes: the second one stays a line of its own, nothing twice
    const fork = joinLines([piece([1, 2]), piece([2, 3]), piece([3, 4]), piece([3, 6])]);
    expect(fork.map((f) => f.lons)).toEqual([
      [1, 2, 3, 6],
      [3, 4],
    ]);
    expect(joined.map((f) => [f.cls, f.lons])).toEqual([
      ['minor', [1, 2, 3, 4, 5, 6]],
      ['minor', [9, 10]],
      ['path', [6, 7]],
      ['forest', [0, 1]],
      ['forest', [1, 2]],
    ]);
  });

  it('takes every tile within the corridor, once', () => {
    // 3 km eastwards at 44° N, a point every 250 m
    const line: [number, number][] = Array.from({ length: 13 }, (_, i) => [44.08, 1.75 + (i * 250) / 80_080]);
    const tiles = tilesAround(line, 1650);
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length);
    // 6.3 km × 3.3 km, z14 tiles of 1.76 km × 1.76 km: 4 or 5 columns, 2 or 3 rows
    expect(tiles.length).toBeGreaterThanOrEqual(8);
    expect(tiles.length).toBeLessThanOrEqual(15);
  });

  it('fetches the tiles once, and words a failure', async () => {
    const asked: string[] = [];
    const tile = mvt({ waterway: [{ type: 2, props: { class: 'river' }, rings: [[[0, 0], [100, 100]]] }] });
    const ok = (async (url: string) => {
      asked.push(url);
      if (url === TILEJSON_URL) return new Response(JSON.stringify({ tiles: ['https://t.test/{z}/{x}/{y}.pbf'] }));
      return new Response(tile.slice().buffer as ArrayBuffer);
    }) as typeof fetch;
    const line: [number, number][] = [[44.08, 1.75]];
    const progress: number[] = [];
    const features = await fetchOsmFeatures(line, 500, ok, (r) => progress.push(r));
    const tiles = asked.filter((u) => u.startsWith('https://t.test/14/'));
    expect(features).toHaveLength(tiles.length);
    expect(progress.at(-1)).toBe(1);
    await fetchOsmFeatures(line, 500, ok);
    expect(asked.filter((u) => u.startsWith('https://t.test/'))).toHaveLength(tiles.length);

    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(fetchOsmFeatures([[45.5, 3.1]], 500, down)).rejects.toThrow('Carte incomplète');
  });
});
