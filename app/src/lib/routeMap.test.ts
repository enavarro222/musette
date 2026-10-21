import type { LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { ParsedRoute, RouteAnalysis } from './core';
import { routeMapData } from './routeMap';

const route: ParsedRoute = { name: 'Col', lats: [45, 45.01, 45.02, 45.03], lons: [5, 5.01, 5, 5.01], eles: [] };
const analysis = (climbs: Partial<RouteAnalysis['climbs'][number]>[]): RouteAnalysis =>
  ({
    distanceM: 4000,
    simplified: [0, 1, 2, 3],
    simplifiedM: [0, 1000, 2000, 3000],
    climbs,
  }) as RouteAnalysis;

const kinds = (d: ReturnType<typeof routeMapData>) => d!.features.features.map((f) => f.properties!.kind);

describe('route map data', () => {
  it('draws the route, start and finish, and fits the route', () => {
    const d = routeMapData(route, analysis([]))!;
    expect(kinds(d)).toEqual(['route', 'start', 'finish']);
    expect(d.bounds).toEqual([5, 45, 5.01, 45.03]);
  });

  it('draws a climb over the points it covers, reaching its ends', () => {
    const d = routeMapData(route, analysis([{ startM: 1500, endM: 2500 }]))!;
    const climb = d.features.features.find((f) => f.properties!.kind === 'climb')!;
    // From the point before 1500 m to the one after 2500 m.
    expect((climb.geometry as LineString).coordinates).toEqual([
      [5.01, 45.01],
      [5, 45.02],
      [5.01, 45.03],
    ]);
  });

  it('has nothing to show for a single point', () => {
    expect(routeMapData(route, { ...analysis([]), simplified: [0], simplifiedM: [0] })).toBeUndefined();
  });
});
