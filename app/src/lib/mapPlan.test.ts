import { describe, expect, it } from 'vitest';
import { loadCore, type ParsedRoute } from './core';
import { choices, DEFAULT_OPTIONS, leftOut, planMap, routeLine } from './mapPlan';
import type { OsmFeature } from './osm';

/** 5.5 km northwards at 3° E, a point every 10 m. */
const n = 551;
const route: ParsedRoute = {
  name: 'Nord',
  lats: Array.from({ length: n }, (_, i) => 45 + (i * 10) / 111_320),
  lons: Array(n).fill(3),
  eles: Array(n).fill(200),
};

/** A line along the route, `dx` metres east of it, wiggling so that it keeps its points. */
function along(cls: OsmFeature['cls'], dx: number): OsmFeature {
  const lats = Array.from({ length: 200 }, (_, i) => 45 + (i * 25) / 111_320);
  const lons = lats.map((_, i) => 3 + (dx + (i % 2) * 15) / 78_710);
  return { cls, lats, lons };
}

const features: OsmFeature[] = [
  along('minor', 100),
  // kept by a 1 km corridor, not by 500 m (whole cells of 500 m)
  along('minor', 1200),
  ...Array.from({ length: 12 }, (_, k) => along('path', 150 + k * 60)),
  along('track', -300),
  along('forest', -600),
];

describe('the map sent with a route', () => {
  it('takes the richest detail when the device has room', async () => {
    const plan = planMap(await loadCore(), route, features, DEFAULT_OPTIONS, 1_000_000);
    expect(plan).toMatchObject({ detail: 'full', corridorM: 1000, fits: true, reduced: false });
    expect(plan.bytes.length).toBeGreaterThan(0);
  });

  it('leaves out the details that do not fit, and says which', async () => {
    const core = await loadCore();
    const full = planMap(core, route, features, DEFAULT_OPTIONS).bytes.length;
    const plan = planMap(core, route, features, DEFAULT_OPTIONS, full - 1);
    expect(plan).toMatchObject({ detail: 'essential', fits: true, reduced: true });
    expect(leftOut(plan, DEFAULT_OPTIONS)).toContain('paths');
  });

  it('gives the smallest map tried when none fits', async () => {
    const plan = planMap(await loadCore(), route, features, DEFAULT_OPTIONS, 10);
    expect(plan).toMatchObject({ detail: 'light', corridorM: 500, fits: false });
  });

  it('tries only the options set by hand', () => {
    expect(choices({ ...DEFAULT_OPTIONS, detail: 'essential', corridorM: 2000 })).toHaveLength(1);
    expect(choices({ ...DEFAULT_OPTIONS, detail: 'custom', contents: ['roads'] })).toEqual([
      { detail: 'custom', corridorM: 1000, contents: ['roads'] },
    ]);
    const auto = (corridorM: 500 | 1000) =>
      choices({ ...DEFAULT_OPTIONS, corridorM }).map((c) => `${c.detail}@${c.corridorM}`);
    expect(auto(1000)).toEqual(['full@1000', 'essential@1000', 'essential@500', 'light@500']);
    expect(auto(500)).toEqual(['full@500', 'essential@500', 'light@500']);
  });

  it('fetches the map along a lighter line that keeps both ends', async () => {
    const analysis = (await loadCore()).analyzeRoute(route.lats, route.lons, route.eles);
    const line = routeLine(
      { ...route, lons: route.lons.map((l, i) => l + (i % 2) * 1e-4) },
      { ...analysis, simplified: route.lats.map((_, i) => i), simplifiedM: route.lats.map((_, i) => i * 10) },
    );
    expect(line).toHaveLength(23);
    expect(line[0][0]).toBe(route.lats[0]);
    expect(line.at(-1)![0]).toBe(route.lats[n - 1]);
  });
});
