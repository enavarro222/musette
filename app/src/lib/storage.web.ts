/**
 * Web: local storage of rides and routes in IndexedDB. Nothing leaves the
 * browser; it stays in this browser only (cleared with the site's data).
 * Same API as `storage.ts` (iOS, Android).
 */
import {
  newestFirst,
  type ActivityStore,
  type RouteStore,
  type StoredActivity,
  type StoredRoute,
} from './storage.types';

export type { RouteSummary, StoredActivity, StoredRoute } from './storage.types';
export { newRouteId } from './storage.types';

const DB = 'musette';
type Store = 'activities' | 'routes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 1: activities; 2: + routes.
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('activities')) db.createObjectStore('activities', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const activities: ActivityStore = {
  put: async (a) => void (await tx('activities', 'readwrite', (s) => s.put(a))),
  has: async (key) => (await tx('activities', 'readonly', (s) => s.count(key))) > 0,
  all: async () => newestFirst(await tx<StoredActivity[]>('activities', 'readonly', (s) => s.getAll())),
  remove: async (key) => void (await tx('activities', 'readwrite', (s) => s.delete(key))),
};

export const routes: RouteStore = {
  put: async (r) => void (await tx('routes', 'readwrite', (s) => s.put(r))),
  get: (id) => tx<StoredRoute | undefined>('routes', 'readonly', (s) => s.get(id)),
  all: async () =>
    (await tx<StoredRoute[]>('routes', 'readonly', (s) => s.getAll()))
      .map(({ gpx: _, ...summary }) => summary)
      .sort((a, b) => b.importedAt - a.importedAt),
  remove: async (id) => void (await tx('routes', 'readwrite', (s) => s.delete(id))),
};

/** Offer a file to the user (download or OS share sheet). */
export async function shareFile(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<void> {
  const file = new File([new Uint8Array(bytes)], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
