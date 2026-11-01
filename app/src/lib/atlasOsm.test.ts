import { describe, expect, it } from 'vitest';
import { mvt } from '../test/mvt';
import { atlasSourceZoom, atlasTileRange, fetchAtlasOsm, readAtlasTile } from './atlasOsm';
import { validAtlasBounds, type AtlasBounds } from './atlasGeometry';
import { TILEJSON_URL } from './osm';

const tile = mvt({
  transportation: [
    { type: 2, props: { class: 'tertiary' }, rings: [[[100, 100], [3000, 3000]]] },
    { type: 2, props: { class: 'path' }, rings: [[[1000, 1000], [2000, 3000]]] },
  ],
  waterway: [{ type: 2, props: { class: 'stream' }, rings: [[[200, 1000], [3000, 1000]]] }],
  place: [
    { type: 1, props: { class: 'village', name: 'Évry', rank: '8' }, rings: [[[2000, 2000]]] },
    { type: 1, props: { class: 'country', name: 'France' }, rings: [[[1000, 1000]]] },
  ],
  boundary: [{ type: 2, props: { admin_level: '6' }, rings: [[[0, 2000], [4096, 2000]]] }],
  water: [{ type: 3, props: { class: 'lake' }, rings: [[[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]] }],
});

describe('OSM extraction for a manual atlas area', () => {
  it('chooses a bounded source zoom for both a village and Europe', () => {
    const village: AtlasBounds = [2.0, 43.0, 2.03, 43.03];
    const europe: AtlasBounds = [-25, 34, 45, 72];
    expect(atlasSourceZoom(village)).toBe(14);
    expect(atlasSourceZoom(europe)).toBeLessThan(9);
    for (const bounds of [village, europe]) expect(atlasTileRange(bounds, atlasSourceZoom(bounds)).count).toBeLessThanOrEqual(256);
    expect(validAtlasBounds([170, 40, -170, 50])).toBe(false);
    expect(validAtlasBounds([1, 2, Infinity, 3])).toBe(false);
    expect(() => atlasTileRange([1, 20, 2, 90], 12)).toThrow();
  });

  it('extracts local roads, paths, streams, named villages, departments and real lake shores', () => {
    const features = readAtlasTile(tile, 8, 5, 4);
    expect(features.map((f) => f.cls)).toEqual(expect.arrayContaining(['minor', 'path', 'stream', 'city', 'department', 'lake']));
    expect(features.filter((f) => f.cls === 'city').map((f) => f.label)).toEqual(['Evry']);
    const lake = features.filter((f) => f.cls === 'lake');
    expect(lake).toHaveLength(1);
    expect(lake[0].lats).toHaveLength(3); // The top/left tile edges are not lake shores.
  });

  it('keeps main axes, secondary roads and local streets distinct', async () => {
    const classes = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
    const roads = mvt({ transportation: classes.map((cls, i) => ({ type: 2,
      props: { class: cls }, rings: [[[200, 200 + i * 200], [3000, 200 + i * 200]]] })) });
    const features = readAtlasTile(roads, 8, 5, 4);
    expect(features.map((f) => [f.cls, f.roadRank])).toEqual([
      ['road', 0], ['road', 1], ['road', 2], ['minor', 3], ['minor', 4], ['minor', 5], ['minor', 6],
    ]);
    const get = (async (input: RequestInfo | URL) => String(input) === TILEJSON_URL
      ? new Response(JSON.stringify({ tiles: ['https://tiles.test/{z}/{x}/{y}'] }))
      : new Response(roads.slice().buffer)) as typeof fetch;
    const merged = await fetchAtlasOsm([1, 43, 1.1, 43.1], { get });
    expect(new Set(merged.features.filter((f) => f.cls === 'road').map((f) => f.roadRank))).toEqual(new Set([0, 1, 2]));
    expect(new Set(merged.features.filter((f) => f.cls === 'minor').map((f) => f.roadRank))).toEqual(new Set([3, 4, 5, 6]));
  });

  it('keeps the coastline of an island without drawing ocean tile edges', () => {
    const ocean = mvt({ water: [{ type: 3, props: { class: 'ocean' }, rings: [
      [[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]],
      [[1000, 1000], [1000, 2000], [2000, 2000], [2000, 1000], [1000, 1000]],
    ] }] });
    const outlines = readAtlasTile(ocean, 8, 5, 4);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].cls).toBe('boundary');
    expect(outlines[0].lats).toHaveLength(5);
  });

  it('downloads at most four tiles in parallel and reports complete progress', async () => {
    const bounds: AtlasBounds = [1, 43, 1.2, 43.2];
    let active = 0, peak = 0, count = 0;
    const get = (async (input: RequestInfo | URL) => {
      if (String(input) === TILEJSON_URL) return new Response(JSON.stringify({ tiles: ['https://tiles.test/{z}/{x}/{y}'] }));
      active++; peak = Math.max(peak, active); count++;
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return new Response(tile.slice().buffer);
    }) as typeof fetch;
    const progress: number[] = [];
    const data = await fetchAtlasOsm(bounds, { get, onProgress: (p) => progress.push(p.done / p.total) });
    expect(peak).toBeLessThanOrEqual(4);
    expect(count).toBe(data.tiles);
    expect(progress.at(-1)).toBe(1);
    expect(data.features.some((f) => f.cls === 'minor')).toBe(true);
  });

  it('keeps a source with secondary roads by dropping dense water geometry before lowering its zoom', async () => {
    const bounds: AtlasBounds = [1, 43, 2, 44];
    const ring = Array.from({ length: 12000 }, (_, i) => [
      Math.round(2048 + 1800 * Math.cos(i / 12000 * Math.PI * 2)),
      Math.round(2048 + 1800 * Math.sin(i / 12000 * Math.PI * 2)),
    ] as [number, number]);
    ring.push(ring[0]);
    const dense = mvt({
      transportation: [
        { type: 2, props: { class: 'primary' }, rings: [[[100, 100], [3900, 3900]]] },
        { type: 2, props: { class: 'secondary' }, rings: [[[100, 3900], [3900, 100]]] },
      ],
      water: [{ type: 3, props: { class: 'lake' }, rings: [ring] }],
    });
    const zooms = new Set<number>();
    const get = (async (input: RequestInfo | URL) => {
      if (String(input) === TILEJSON_URL) return new Response(JSON.stringify({ tiles: ['https://tiles.test/{z}/{x}/{y}'] }));
      zooms.add(Number(new URL(String(input)).pathname.split('/')[1]));
      return new Response(dense.slice().buffer);
    }) as typeof fetch;
    const data = await fetchAtlasOsm(bounds, { get });
    expect(zooms).toEqual(new Set([atlasSourceZoom(bounds)]));
    expect(data.features.some((f) => f.cls === 'road')).toBe(true);
    expect(data.features.some((f) => f.roadRank === 3)).toBe(true);
    expect(data.features.some((f) => f.cls === 'lake')).toBe(false);
    expect(data.features.reduce((n, f) => n + f.lats.length, 0)).toBeLessThanOrEqual(300_000);
  });

  it('propagates errors and cancels without starting another tile', async () => {
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    const get = (async () => { calls++; return new Response('', { status: 503 }); }) as typeof fetch;
    await expect(fetchAtlasOsm([1, 43, 1.1, 43.1], { get, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
    await expect(fetchAtlasOsm([1, 43, 1.1, 43.1], { get })).rejects.toThrow('injoignable');
  });
});
