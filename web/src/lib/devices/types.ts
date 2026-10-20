/** Mirrors `crates/device`. */
export type ModelId = 'open-cc600' | 'bryton-rider-750';

/** Files a device can receive. */
export type FileKind = 'route' | 'map';

export interface Capabilities {
  downloadActivities: boolean;
  uploadRoute: boolean;
  routeCorridorMap: boolean;
  climbsOnDevice: boolean;
  settings: boolean;
  sensors: boolean;
  wifiSync: boolean;
}

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
  readonly capabilities: Capabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listActivities(): Promise<ActivityRef[]>;
  /** Returns the FIT bytes, already integrity-checked. */
  downloadActivity(ref: ActivityRef, onProgress?: (ratio: number) => void): Promise<Uint8Array>;
  /** Tell the device the copy is safe (it may free it later). */
  acknowledgeActivity?(ref: ActivityRef, fit: Uint8Array): Promise<void>;
  uploadRoute?(gpx: string): Promise<void>;
  /**
   * Send a prepared file (route or corridor map), resuming an interrupted
   * transfer of the same file. `onProgress` gets the share the device holds.
   */
  uploadFile?(kind: FileKind, bytes: Uint8Array, onProgress?: (ratio: number) => void): Promise<void>;
}
