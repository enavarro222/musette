import type { Device } from './devices/types';
import type { MusettePlatform } from './platform';

/** App-wide reactive state (Svelte 5 runes). */
export const app = $state<{
  platform?: MusettePlatform;
  device?: Device;
  connecting: boolean;
  error?: string;
  /** Route file received from the OS (file handler / share). */
  pendingRoute?: File;
}>({ connecting: false });

export function reportError(e: unknown) {
  // User cancelled a browser chooser: not an error worth showing.
  if (e instanceof DOMException && e.name === 'NotFoundError') return;
  if (e instanceof DOMException && e.name === 'AbortError') return;
  app.error = e instanceof Error ? e.message : String(e);
}
