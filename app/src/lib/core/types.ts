/**
 * The Rust core as the app sees it, the same on every platform: WASM on the
 * web (`load.ts`, crates/musette-wasm), UniFFI on iOS and Android
 * (`load.native.ts`, crates/musette-ffi). Both wrap crates/musette-core.
 */

export interface ClimbInfo {
  startM: number;
  endM: number;
  gainM: number;
  avgGrade: number;
  maxGrade: number;
  category: 'uncategorized' | '4' | '3' | '2' | '1' | 'HC';
}

export interface RouteAnalysis {
  distanceM: number;
  ascentM: number;
  profileStepM: number;
  profile: number[];
  climbs: ClimbInfo[];
  /** Indices of the points kept after simplification. */
  simplified: number[];
  /** Distance from the start at each `simplified` point, metres. */
  simplifiedM: number[];
}

/** A route read from a GPX file, device-neutral. */
export interface ParsedRoute {
  name: string;
  lats: number[];
  lons: number[];
  /** NaN where elevation is missing. */
  eles: number[];
}

/** Mirrors `crates/device` (`Model::id`). */
export type ModelId = 'open-cc600' | 'bryton-rider-750';

/** How the app reaches a device. */
export type Link = 'ble' | 'usbFiles';

/** Files a device can receive. */
export type FileKind = 'route' | 'map';

/** What a map feature is (`musette_core::MAP_CLASSES`). Contour lines are not drawn from OSM. */
export type MapClass =
  | 'forest'
  | 'water'
  | 'residential'
  | 'contour'
  | 'contour50'
  | 'stream'
  | 'river'
  | 'path'
  | 'track'
  | 'service'
  | 'minor'
  | 'major';

/** Map features, flat: feature `i` is a `classes[i]` with the next `lengths[i]` points of `lats`/`lons` (degrees). */
export interface MapFeatures {
  classes: MapClass[];
  lengths: number[];
  lats: number[];
  lons: number[];
}

/** What a device can do over a link (`crates/device`). */
export interface Capabilities {
  downloadActivities: boolean;
  uploadRoute: boolean;
  routeCorridorMap: boolean;
  climbsOnDevice: boolean;
  settings: boolean;
  sensors: boolean;
  wifiSync: boolean;
}

/** A GATT characteristic of a session; its index is its channel number. UUIDs in lower case. */
export interface Channel {
  service: string;
  characteristic: string;
  withResponse: boolean;
  /** A write may be cut into packets of the link's size. */
  split: boolean;
}

export interface Write {
  channel: number;
  bytes: Uint8Array;
}

/** A ride on the device, as the session lists it. */
export interface DeviceActivity {
  id: string;
  /** Unix seconds. */
  startTime?: number;
  /** `startTime` is the device's wall clock read as UTC. */
  localTime: boolean;
  size?: number;
  synced?: boolean;
}

/** A setting's value: `number` for a bool (0, 1) and a number, `text` for a choice and a text. */
export interface DeviceSetting {
  key: string;
  number?: number;
  text: string;
}

/** What a setting takes, as the device says. */
export interface DeviceField {
  key: string;
  kind: 'bool' | 'number' | 'choice' | 'text';
  min?: number;
  max?: number;
  /** `choice`: the values, and their names in English. */
  options: string[];
  labels: string[];
  writable: boolean;
}

/** Why a request failed (`musette_core::session::Failure`). */
export interface Failure {
  code:
    | 'timeout'
    | 'stalled'
    | 'refused'
    | 'badSetting'
    | 'corrupted'
    | 'interrupted'
    | 'recording'
    | 'badRequest'
    | 'noSpace'
    | 'noTransfer'
    | 'incomplete'
    | 'badCrc'
    | 'busy'
    | 'storage';
  detail: string;
}

/** How a request ended. */
export type Outcome =
  | { kind: 'done' }
  | {
      kind: 'info';
      name: string;
      recording: boolean;
      /** The largest file the device takes now, by kind, the one it replaces counted as free (0: no room now). */
      routeMax?: number;
      mapMax?: number;
      /** Bytes free for rides. */
      free?: number;
    }
  | { kind: 'activities'; activities: DeviceActivity[] }
  | { kind: 'file'; bytes: Uint8Array }
  | { kind: 'settings'; fields: DeviceField[]; values: DeviceSetting[] }
  | ({ kind: 'failed' } & Failure);

/** What to do after a request or a notification. */
export interface Step {
  /** Channels to subscribe to, before the writes. */
  subscribe: number[];
  /** In order. */
  writes: Write[];
  /** Share of the request done, 0..1. */
  progress?: number;
  /** Call `onTimeout` after this long: 0 no timer, undefined keep the current one. */
  waitMs?: number;
  /** The request is over. */
  outcome?: Outcome;
}

/** How long a device may stay silent (the model's own when not given). */
export interface Timing {
  requestMs: number;
  /** Where silence means something: a CC600 transfer asks where the device is. */
  shortMs: number;
}

/** One connection to a device of any model (`musette_core::Session`). One request at a time. */
export interface Session {
  channels(): Channel[];
  connect(): Step;
  listActivities(): Step;
  download(id: string, size?: number): Step;
  acknowledge(id: string): Step;
  sendRoute(route: ParsedRoute): Step;
  sendFile(kind: FileKind, bytes: Uint8Array): Step;
  /** What the device says of itself now (`info`), once connected: a CC600's room. Throws for a device that says nothing. */
  deviceInfo(): Step;
  readSettings(): Step;
  /** Throws, before anything is sent, on the first change the device cannot take. */
  writeSettings(changes: DeviceSetting[]): Step;
  onNotify(channel: number, bytes: Uint8Array): Step;
  onTimeout(): Step;
  /** Frees the Rust object. */
  free(): void;
}

export interface SimulatorOptions {
  /** Transfer window (default 2048). */
  window?: number;
  /** Free bytes for a file (default 1 MiB). */
  free?: number;
  /** The settings file (`key=value` lines). */
  settings?: string;
  /** `TransferChunk`s lost (1-based, over the device's life). */
  loseChunks?: number[];
  /** `TransferAck`s lost. */
  loseAcks?: number[];
}

/** A CC600 in memory: frames in, frames out (`musette_core::Cc600Simulator`). */
export interface Cc600Simulator {
  /** `startTime` in Unix seconds. */
  addActivity(id: number, startTime: number, fit: Uint8Array): void;
  /** The frames the device answers. */
  write(bytes: Uint8Array): Uint8Array[];
  /** The link dropped: the partial file stays. */
  disconnect(): void;
  received(): number;
  committed(): Uint8Array | undefined;
  chunkBytes(): number;
  acked(): number[];
  settings(): string;
  settingsWrites(): string[];
}

export interface Core {
  analyzeRoute(lats: number[], lons: number[], eles: number[]): RouteAnalysis;
  /** Throws `Error('noPoints' | 'badPoint')`. */
  parseGpx(text: string): ParsedRoute;
  /** Throws if the FIT file is truncated or corrupted; returns its data size. */
  verifyFit(bytes: Uint8Array): number;
  /** The CC600 background map (`OCMP`) of the route file `sendRoute` writes for `route`: the features within `corridorM` of it. */
  cc600BuildMap(route: ParsedRoute, features: MapFeatures, corridorM: number): Uint8Array;
  brytonFindActivities(paths: string[], sizes: number[]): { id: string; size?: number }[];

  capabilities(model: ModelId, link: Link): Capabilities;
  settingFields(model: ModelId): DeviceField[];
  session(model: ModelId, timing?: Timing): Session;
  cc600Simulator(options?: SimulatorOptions): Cc600Simulator;
}
