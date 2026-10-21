import type { Capabilities, FileKind, ModelId, ParsedRoute } from '../core';
import type { DeviceSettings, SettingValues } from '../settings';

export type { Capabilities, FileKind, ModelId } from '../core';

/** Before the device is connected: it does nothing yet. */
export const NO_CAPABILITIES: Capabilities = {
  downloadActivities: false,
  uploadRoute: false,
  routeCorridorMap: false,
  climbsOnDevice: false,
  settings: false,
  sensors: false,
  wifiSync: false,
};

export interface ActivityRef {
  id: string;
  startTime?: number;
  size?: number;
  /** Already copied by an app (when the device tracks it). */
  synced?: boolean;
}

export interface Device {
  readonly model: ModelId;
  readonly name: string;
  /** From the Rust core (`crates/device`), once connected. */
  readonly capabilities: Capabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listActivities(): Promise<ActivityRef[]>;
  /** Returns the FIT bytes, already integrity-checked. */
  downloadActivity(ref: ActivityRef, onProgress?: (ratio: number) => void): Promise<Uint8Array>;
  /** Tell the device the copy is safe (it may free it later). */
  acknowledgeActivity?(ref: ActivityRef, fit: Uint8Array): Promise<void>;
  /**
   * Replace the device's route. The route is device-neutral (name, points);
   * each driver writes it in its own format (OCRT for the CC600, a FIT course
   * for others).
   */
  uploadRoute?(route: ParsedRoute, onProgress?: (ratio: number) => void): Promise<void>;
  /**
   * Send a prepared file (route or corridor map), resuming an interrupted
   * transfer of the same file. `onProgress` gets the share the device holds.
   */
  uploadFile?(kind: FileKind, bytes: Uint8Array, onProgress?: (ratio: number) => void): Promise<void>;
  /** The device's settings and how to edit them (when `capabilities.settings`). */
  readSettings?(): Promise<DeviceSettings>;
  /** Change settings (only the changed ones), all or nothing. */
  writeSettings?(changes: SettingValues): Promise<void>;
}
