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

export interface DecodedFrame {
  op: number;
  seq: number;
  payload: Uint8Array;
  /** Bytes of the input the frame took. */
  consumed: number;
}

/** A CC600 setting as `settings-cc600` describes it. */
export interface Cc600Field {
  key: string;
  kind: 'onOff' | 'range' | 'choice' | 'tz' | 'sensor';
  min?: number;
  max?: number;
  options: string[];
}

/** App side of a CC600 file transfer (`protocol_cc600::transfer::Sender`). */
export interface Cc600Sender {
  /** Applies a `TransferReady` payload; returns the offset to start from. */
  ready(payload: Uint8Array): number;
  ack(payload: Uint8Array): void;
  resend(payload: Uint8Array): void;
  /** `[offset, length]` of the next chunk, or undefined when the window is full or all was sent. */
  nextChunk(max: number): [number, number] | undefined;
  /** Everything was sent and acknowledged. */
  done(): boolean;
  /** Share of the file the device holds, 0..=1000. */
  permille(): number;
  /** Frees the Rust object. */
  free(): void;
}

/** Device side of a CC600 file transfer, file in memory (simulated CC600). */
export interface Cc600Receiver {
  /** The answer to a transfer request as `[op, ...payload]`, or undefined. */
  handle(op: number, payload: Uint8Array): Uint8Array | undefined;
  disconnect(): void;
  received(): number;
  committed(): Uint8Array | undefined;
}

/** Bytes to write to a Bryton characteristic: 0 command, 1 data, 2 setting. */
export interface BrytonWrite {
  channel: number;
  bytes: Uint8Array;
}

/** A ride in a Bryton's "not synced" list. */
export interface BrytonRide {
  /** `yyMMddHHmmss`, local time: also its file name over USB. */
  id: string;
  timeS: number;
  distanceM: number;
  sport: number;
}

export interface BrytonInfo {
  /** The first 4 digits are the product code (1902: Rider 750). */
  id: string;
  firmware: string;
  model: string;
  recording: boolean;
  /** It has the setting channel (settings, acknowledgement, routes). */
  settings: boolean;
}

/** What happened (`BrytonSession.onNotify`); `kind` says which fields count. */
export interface BrytonEvent {
  kind: 'info' | 'ready' | 'rides' | 'progress' | 'file' | 'sent' | 'routeNamed' | 'settingAck' | 'setting' | 'failed';
  /** `failed`, in English. */
  message: string;
  /** `file`: the ride; `setting`: the whole frame. */
  bytes: Uint8Array;
  done: number;
  total: number;
  /** `settingAck`, `setting`: the setting command; `settingAck`: its status (10 = ok). */
  cmd: number;
  status: number;
  rides: BrytonRide[];
  info?: BrytonInfo;
}

export interface BrytonStep {
  /** Write them in order. */
  writes: BrytonWrite[];
  events: BrytonEvent[];
}

/** One Bryton BLE connection (`musette_core::BrytonSession`). */
export interface BrytonSession {
  readDeviceInfo(): BrytonWrite;
  newApp(): BrytonWrite;
  listRides(): BrytonWrite;
  download(id: string): BrytonWrite;
  acknowledge(id: string): BrytonWrite;
  sendRoute(fit: Uint8Array, deviceId: string): BrytonWrite;
  sendRouteName(name: string): BrytonWrite;
  settingGet(key: string): BrytonWrite;
  settingSet(key: string, value: number): BrytonWrite;
  onNotify(channel: number, bytes: Uint8Array): BrytonStep;
  free(): void;
}

export interface BrytonField {
  /** `user.height`, `bike0.auto_pause`... */
  key: string;
  kind: 'bool' | 'choice' | 'number' | 'text';
  /** `choice`: labels indexed by value (English). */
  choices: string[];
  writable: boolean;
}

export interface BrytonValue {
  number?: number;
  text: string;
}

export interface Core {
  analyzeRoute(lats: number[], lons: number[], eles: number[]): RouteAnalysis;
  /** Throws `Error('noPoints' | 'badPoint')`. */
  parseGpx(text: string): ParsedRoute;
  /** Throws if the FIT file is truncated or corrupted; returns its data size. */
  verifyFit(bytes: Uint8Array): number;
  brytonFindActivities(paths: string[], sizes: number[]): { id: string; size?: number }[];

  cc600Encode(op: number, seq: number, payload: Uint8Array): Uint8Array;
  /** Undefined when more bytes are needed. */
  cc600Decode(bytes: Uint8Array): DecodedFrame | undefined;
  cc600BuildRoute(name: string, lats: number[], lons: number[], eles: number[]): Uint8Array;
  cc600TransferBegin(kind: number, bytes: Uint8Array): Uint8Array;
  cc600TransferChunk(offset: number, data: Uint8Array): Uint8Array;
  cc600Sender(size: number): Cc600Sender;
  cc600Receiver(window: number, free: number): Cc600Receiver;

  cc600SettingsFields(): Cc600Field[];
  /** Every key, values as text. */
  cc600SettingsParse(text: string): Record<string, string>;
  /** The new settings file; throws an Error whose message is the refused key. */
  cc600SettingsApply(current: string, changes: string): string;

  brytonSession(): BrytonSession;
  /** A Bryton route file (start and arrival turns only). */
  brytonBuildRoute(lats: number[], lons: number[], eles: number[]): Uint8Array;
  brytonSettingFields(): BrytonField[];
  /** Decodes the answer to the get of `key` (a `setting` event's bytes). */
  brytonSettingValue(key: string, frame: Uint8Array): BrytonValue | undefined;
}
