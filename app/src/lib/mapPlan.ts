/**
 * What goes with a route to a device that draws a background map: the
 * corridor and the detail, chosen "at best" to fit what the device takes,
 * unless set by hand (the send options).
 */
import type { Core, MapClass, ParsedRoute, RouteAnalysis } from './core';
import { flatFeatures, type OsmFeature } from './osm';

/** Contents of the map, as the send options show them. */
export type MapContent = 'roads' | 'tracks' | 'paths' | 'service' | 'water' | 'streams' | 'forests' | 'villages';

export const CONTENTS: Record<MapContent, { label: string; classes: MapClass[] }> = {
  roads: { label: 'Routes', classes: ['major', 'minor'] },
  tracks: { label: 'Pistes', classes: ['track'] },
  paths: { label: 'Chemins et pistes cyclables', classes: ['path'] },
  service: { label: 'Dessertes et parkings', classes: ['service'] },
  water: { label: 'Lacs et rivières', classes: ['water', 'river'] },
  streams: { label: 'Ruisseaux', classes: ['stream'] },
  forests: { label: 'Forêts', classes: ['forest'] },
  villages: { label: 'Villages', classes: ['residential'] },
};

export type Detail = 'full' | 'essential' | 'light';

/** The details "at best" tries, richest first. */
export const DETAILS: Record<Detail, { label: string; contents: MapContent[] }> = {
  full: { label: 'Complet', contents: Object.keys(CONTENTS) as MapContent[] },
  essential: { label: 'Essentiel', contents: ['roads', 'tracks', 'water', 'forests', 'villages'] },
  light: { label: 'Léger', contents: ['roads', 'water', 'villages'] },
};

export const CORRIDORS = [500, 1000, 2000] as const;
export type Corridor = (typeof CORRIDORS)[number];

/** The send options; the defaults are the happy path. */
export interface SendOptions {
  /** Send the background map with the route. */
  map: boolean;
  /** `auto`: the richest detail that fits, narrowing to 500 m at last. */
  detail: 'auto' | Detail | 'custom';
  corridorM: Corridor;
  /** `custom` detail. */
  contents: MapContent[];
}

export const DEFAULT_OPTIONS: SendOptions = {
  map: true,
  detail: 'auto',
  corridorM: 1000,
  contents: DETAILS.essential.contents,
};

/** One way to build the map. */
export interface MapChoice {
  detail: Detail | 'custom';
  corridorM: number;
  contents: MapContent[];
}

/** What the map would be. */
export interface MapPlan extends MapChoice {
  bytes: Uint8Array;
  /** Within the device's limit. */
  fits: boolean;
  /** The choice was made smaller than the options to fit. */
  reduced: boolean;
}

/**
 * The choices to try, in order: one unless `auto`. `auto` keeps the detail
 * near the route rather than the width: complete, essential, essential on
 * 500 m, light on 500 m.
 */
export function choices(o: SendOptions): MapChoice[] {
  if (o.detail === 'custom') return [{ detail: 'custom', corridorM: o.corridorM, contents: o.contents }];
  if (o.detail !== 'auto') return [{ detail: o.detail, corridorM: o.corridorM, contents: DETAILS[o.detail].contents }];
  const at = (detail: Detail, corridorM: number) => ({ detail, corridorM, contents: DETAILS[detail].contents });
  const narrow = Math.min(o.corridorM, 500);
  const all = [at('full', o.corridorM), at('essential', o.corridorM), at('essential', narrow), at('light', narrow)];
  return all.filter((c, i) => i === 0 || c.detail !== all[i - 1].detail || c.corridorM !== all[i - 1].corridorM);
}

/**
 * How far from the route to fetch OSM for a corridor: the map keeps the
 * cells of 500 m within the corridor (crates/route-cc600, `build_map`), so
 * up to a cell further, and the points of `routeLine` are up to 250 m apart.
 */
export const fetchRadius = (corridorM: number) => corridorM + 500 + 150;

/** Points of the route at least `stepM` apart, both ends kept: where to fetch the map around. */
export function routeLine(route: ParsedRoute, analysis: RouteAnalysis, stepM = 250): [number, number][] {
  const line: [number, number][] = [];
  let last = -Infinity;
  analysis.simplified.forEach((i, k) => {
    const end = k === analysis.simplified.length - 1;
    if (analysis.simplifiedM[k] - last < stepM && !end) return;
    last = analysis.simplifiedM[k];
    line.push([route.lats[i], route.lons[i]]);
  });
  return line;
}

/**
 * The map to send: the first choice that fits `limit` (bytes; undefined:
 * no limit known), else the smallest one tried, with `fits` false.
 */
export function planMap(
  core: Core,
  route: ParsedRoute,
  features: OsmFeature[],
  options: SendOptions,
  limit?: number,
): MapPlan {
  const tried = choices(options);
  let plan: MapPlan | undefined;
  for (const [i, c] of tried.entries()) {
    const keep = new Set(c.contents.flatMap((k) => CONTENTS[k].classes));
    const bytes = core.cc600BuildMap(route, flatFeatures(features, keep), c.corridorM);
    const fits = limit === undefined || bytes.length <= limit;
    if (!plan || bytes.length < plan.bytes.length) plan = { ...c, bytes, fits, reduced: i > 0 };
    if (fits) return { ...c, bytes, fits, reduced: i > 0 };
  }
  return plan!;
}

/** What a reduced plan left out, for "Sans chemins ni ruisseaux". */
export function leftOut(plan: MapPlan, options: SendOptions): MapContent[] {
  const wanted = choices(options)[0].contents;
  return wanted.filter((c) => !plan.contents.includes(c));
}
