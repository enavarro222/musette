import type { TransportFactories } from './transport/types';

/** What the platform the app runs on provides. */
export interface MusettePlatform {
  name: 'web' | 'ios' | 'android';
  transports: TransportFactories;
  /** The Bluetooth button when `blePick` does not ask the user (an emulated device). */
  pickLabel?: string;
  /** Shown next to a device whose transport this platform lacks. */
  unsupported: string;
}
