/**
 * Web: local storage of activities in IndexedDB. Nothing leaves the browser.
 * Same API as `storage.ts` (iOS, Android).
 */
import { newestFirst, type ActivityStore, type StoredActivity } from './storage.types';

export type { StoredActivity } from './storage.types';

const DB = 'musette';
const STORE = 'activities';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const activities: ActivityStore = {
  put: async (a) => void (await tx('readwrite', (s) => s.put(a))),
  has: async (key) => (await tx('readonly', (s) => s.count(key))) > 0,
  all: async () => newestFirst(await tx<StoredActivity[]>('readonly', (s) => s.getAll())),
  remove: async (key) => void (await tx('readwrite', (s) => s.delete(key))),
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
