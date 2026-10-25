import { loadCore, type ParsedRoute, type RouteAnalysis } from './core';
import { parseGpx } from './gpx';
import { newRouteId, routes, type StoredRoute } from './storage';

export interface LibraryRoute {
  route: ParsedRoute;
  analysis: RouteAnalysis;
  reversed: boolean;
}

/** Read the kept direction, then analyse it: climbs and D+ depend on the direction. */
async function readRoute(stored: StoredRoute): Promise<LibraryRoute> {
  const route = await parseGpx(stored.gpx);
  if (stored.reversed) {
    route.lats.reverse();
    route.lons.reverse();
    route.eles.reverse();
  }
  return {
    route,
    analysis: (await loadCore()).analyzeRoute(route.lats, route.lons, route.eles),
    reversed: !!stored.reversed,
  };
}

export async function loadRoute(id: string): Promise<LibraryRoute | undefined> {
  const stored = await routes.get(id);
  return stored ? readRoute(stored) : undefined;
}

/** Keep the opposite direction under the same id, without rewriting the imported GPX. */
export async function reverseRoute(id: string): Promise<LibraryRoute> {
  const stored = await routes.get(id);
  if (!stored) throw new Error('Cette trace n’est plus sur cet appareil.');
  const next = { ...stored, reversed: !stored.reversed };
  const result = await readRoute(next);
  await routes.put({ ...next, distanceM: result.analysis.distanceM, ascentM: result.analysis.ascentM });
  return result;
}

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
