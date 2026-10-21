/** A ride kept on this device (phone or browser). */
export interface StoredActivity {
  /** `${model}:${deviceActivityId}` */
  key: string;
  model: string;
  deviceName: string;
  startTime?: number;
  importedAt: number;
  fileName: string;
  fit: Uint8Array;
}

/** Where rides are kept: IndexedDB on the web, app files on iOS and Android. */
export interface ActivityStore {
  /** Resolves once the ride is safely written. */
  put(a: StoredActivity): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Newest first. */
  all(): Promise<StoredActivity[]>;
  remove(key: string): Promise<void>;
}

export function newestFirst(list: StoredActivity[]): StoredActivity[] {
  const when = (a: StoredActivity) => (a.startTime ? a.startTime * 1000 : a.importedAt);
  return list.sort((a, b) => when(b) - when(a));
}

/** A route kept on this device, as imported (GPX), with what the list shows. */
export interface StoredRoute {
  id: string;
  name: string;
  importedAt: number;
  distanceM: number;
  ascentM: number;
  gpx: string;
}

/** A route as the list shows it: no GPX. */
export type RouteSummary = Omit<StoredRoute, 'gpx'>;

/** Where routes are kept, as rides are. */
export interface RouteStore {
  put(r: StoredRoute): Promise<void>;
  get(id: string): Promise<StoredRoute | undefined>;
  /** Newest first. */
  all(): Promise<RouteSummary[]>;
  remove(id: string): Promise<void>;
}

/** A new route id: time, then randomness (no collision between two imports). */
export function newRouteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
