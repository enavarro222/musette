import { useSyncExternalStore } from 'react';
import type { Device } from './devices/types';

/** App-wide state: a tiny external store, no extra dependency. */
export interface AppState {
  device?: Device;
  connecting: boolean;
  error?: string;
  /** GPX text received from the OS (file handler, share). */
  pendingRoute?: string;
}

let state: AppState = { connecting: false };
const listeners = new Set<() => void>();

export const appStore = {
  get: (): AppState => state,
  set(patch: Partial<AppState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useApp(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}

export function reportError(e: unknown) {
  // User cancelled a browser chooser: not an error worth showing.
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'AbortError')) {
    return;
  }
  appStore.set({ error: e instanceof Error ? e.message : String(e) });
}
