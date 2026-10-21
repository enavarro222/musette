import type { RouteMapData } from '../lib/routeMap';

export interface RouteMapProps {
  data: RouteMapData;
  /**
   * The full-screen map: moves and zooms. Otherwise a still preview in a
   * page, so the page scrolls; the screen opens the full map on a tap.
   */
  full?: boolean;
}
