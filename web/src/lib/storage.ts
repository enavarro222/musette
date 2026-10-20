/**
 * Local storage of activities (IndexedDB). Nothing leaves the browser.
 */
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

export const activities = {
  put: (a: StoredActivity) => tx('readwrite', (s) => s.put(a)),
  has: async (key: string) => (await tx('readonly', (s) => s.count(key))) > 0,
  all: async (): Promise<StoredActivity[]> => {
    const list = await tx<StoredActivity[]>('readonly', (s) => s.getAll());
    const when = (a: StoredActivity) => (a.startTime ? a.startTime * 1000 : a.importedAt);
    return list.sort((a, b) => when(b) - when(a));
  },
  remove: (key: string) => tx('readwrite', (s) => s.delete(key)),
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
