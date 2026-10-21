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
