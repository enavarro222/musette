import { loadCore } from './core';
import { parseGpx } from './gpx';
import { newRouteId, routes, type StoredRoute } from './storage';

/**
 * Add a GPX file to the routes kept on this device. Read (and refused, with
 * a French message) before it is stored.
 */
export async function importRoute(gpx: string, now = Date.now()): Promise<StoredRoute> {
  const parsed = await parseGpx(gpx);
  const analysis = (await loadCore()).analyzeRoute(parsed.lats, parsed.lons, parsed.eles);
  const route: StoredRoute = {
    id: newRouteId(),
    name: parsed.name,
    importedAt: now,
    distanceM: analysis.distanceM,
    ascentM: analysis.ascentM,
    gpx,
  };
  await routes.put(route);
  return route;
}
