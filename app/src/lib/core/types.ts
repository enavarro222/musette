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
}
