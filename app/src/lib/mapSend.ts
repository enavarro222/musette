/**
 * The background map sent with a route: the send options (kept), the OSM
 * features of each route (fetched once), the plan for the connected device,
 * and the sending of both files.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { loadCore, type ParsedRoute, type RouteAnalysis } from './core';
import type { Device } from './devices/types';
import { DEFAULT_OPTIONS, fetchRadius, planMap, routeLine, type MapPlan, type SendOptions } from './mapPlan';
import { fetchOsmFeatures } from './osm';
import { prefs } from './storage';

// ---- the send options ----------------------------------------------------

let options: SendOptions = DEFAULT_OPTIONS;
/** Set by the user since the app started: the kept options, read later, do not undo it. */
let touched = false;
const listeners = new Set<() => void>();
const loaded = prefs
  .get<Partial<SendOptions>>('sendOptions')
  .then((kept) => {
    if (kept && !touched) setOptions({ ...options, ...kept }, false);
  })
  .catch(() => undefined);

export function setOptions(next: SendOptions, keep = true): void {
  options = next;
  listeners.forEach((l) => l());
  if (keep) {
    touched = true;
    void loaded.then(() => prefs.set('sendOptions', next)).catch(() => undefined);
  }
}

export function useSendOptions(): SendOptions {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => options,
  );
}

// ---- the map of a route --------------------------------------------------

export type MapState =
  /** The device draws no map, or the user does not send it. */
  | { status: 'off' }
  /** The device draws one but takes none over this link (older firmware). */
  | { status: 'unsupported' }
  /** No room for a map on the device now (its storage is full). */
  | { status: 'full' }
  /** `ratio`: the share of the map's tiles read. */
  | { status: 'preparing'; ratio: number }
  /** `refit`: the map again for a new limit, from the same data. */
  | { status: 'ready'; plan: MapPlan; limit?: number; refit(limit: number): MapPlan }
  | { status: 'failed'; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The options a map depends on: the others (contents when not custom) change nothing. */
function optionsKey(o: SendOptions): string {
  return JSON.stringify([o.detail, o.corridorM, o.detail === 'custom' ? o.contents : null]);
}

/** A device's number, for the plans' keys (devices are objects, one per connection). */
const deviceIds = new WeakMap<Device, number>();
let devices = 0;
function deviceId(d: Device): number {
  let id = deviceIds.get(d);
  if (id === undefined) deviceIds.set(d, (id = ++devices));
  return id;
}

/**
 * The plan of each route, shared by the screens that show it (the route and
 * its send options, open at once): one hello and one map making for both.
 */
interface Shared {
  key: string;
  state: MapState;
  attempt: number;
  listeners: Set<() => void>;
}
const plans = new Map<string, Shared>();

function shared(routeId: string): Shared {
  let p = plans.get(routeId);
  if (!p) plans.set(routeId, (p = { key: '', state: { status: 'off' }, attempt: 0, listeners: new Set() }));
  return p;
}

function publish(p: Shared, key: string, state: MapState) {
  // an older making (other options, a retry) does not overwrite a newer one
  if (p.key !== key) return;
  p.state = state;
  p.listeners.forEach((l) => l());
}

async function make(p: Shared, key: string, route: ParsedRoute, analysis: RouteAnalysis, device: Device, o: SendOptions) {
  publish(p, key, { status: 'preparing', ratio: 0 });
  try {
    // an older device answers with its first hello's numbers, or none
    await device.refreshInfo?.().catch(() => undefined);
    const limit = device.fileLimits?.map;
    if (limit === undefined) return publish(p, key, { status: 'unsupported' });
    if (limit === 0) return publish(p, key, { status: 'full' });
    const onTile = (ratio: number) => publish(p, key, { status: 'preparing', ratio });
    const features = await fetchOsmFeatures(routeLine(route, analysis), fetchRadius(o.corridorM), undefined, onTile);
    const core = await loadCore();
    const refit = (l: number) => planMap(core, route, features, o, l);
    publish(p, key, { status: 'ready', plan: refit(limit), limit, refit });
  } catch (e) {
    publish(p, key, { status: 'failed', error: message(e) });
  }
}

/**
 * The map to send with route `routeId` to `device`, made again when an
 * option it depends on changes, and a retry after a failure. The device is
 * asked for its room first: it changes with each file and ride.
 */
export function useMapPlan(
  routeId: string,
  route: ParsedRoute | undefined,
  analysis: RouteAnalysis | undefined,
  device: Device | undefined,
): [MapState, () => void] {
  const o = useSendOptions();
  const p = shared(routeId);
  const snapshot = useSyncExternalStore(
    (l) => {
      p.listeners.add(l);
      return () => p.listeners.delete(l);
    },
    () => p.state,
  );
  const attempt = useSyncExternalStore(
    (l) => {
      p.listeners.add(l);
      return () => p.listeners.delete(l);
    },
    () => p.attempt,
  );
  const on = !!(route && analysis && device?.capabilities.routeCorridorMap && o.map);
  const key = on ? `${deviceId(device!)}|${optionsKey(o)}|${attempt}` : '';

  useEffect(() => {
    if (!on || p.key === key) return;
    p.key = key;
    void make(p, key, route!, analysis!, device!, o);
    // `key` holds what the map depends on: the route's id, the device, the options that matter, the retries
  }, [key, route, analysis]);

  const retry = () => {
    p.attempt++;
    p.listeners.forEach((l) => l());
  };
  return [on ? snapshot : { status: 'off' }, retry];
}

/** What is being sent, for the button. */
export interface Sending {
  what: 'route' | 'map';
  ratio: number;
}

/**
 * Sends the route, then its map when there is one that fits: the map is
 * made for the route file the device then holds. The device is asked for its
 * room again in between (the new route took some): a map that no longer fits
 * is made lighter. A failed map leaves the new route in place. Returns the
 * map sent, if any.
 */
export async function sendRouteAndMap(
  device: Device,
  route: ParsedRoute,
  map: MapState,
  onProgress: (s: Sending) => void,
): Promise<MapPlan | undefined> {
  if (!device.uploadRoute) throw new Error('Ce compteur ne prend pas de trace');
  await device.uploadRoute(route, (ratio) => onProgress({ what: 'route', ratio }));
  if (map.status !== 'ready' || !map.plan.fits || !device.uploadFile) return undefined;
  let plan = map.plan;
  await device.refreshInfo?.().catch(() => undefined);
  const limit = device.fileLimits?.map;
  if (limit !== undefined && plan.bytes.length > limit) plan = map.refit(limit);
  if (!plan.fits) return undefined;
  onProgress({ what: 'map', ratio: 0 });
  await device.uploadFile('map', plan.bytes, (ratio) => onProgress({ what: 'map', ratio }));
  return plan;
}
