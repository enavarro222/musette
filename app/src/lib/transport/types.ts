/**
 * Transports move bytes; drivers (in Rust) give them meaning.
 *
 * Each platform provides its own (`platform.web.ts`, `platform.ts`): Web
 * Bluetooth and File System Access in the browser, native Bluetooth on iOS
 * and Android.
 */

/** Message-oriented link, e.g. a BLE GATT pair of characteristics. */
export interface PacketTransport {
  readonly kind: 'packet';
  /** Name of the connected peer, once connected. */
  readonly peerName?: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(bytes: Uint8Array): Promise<void>;
  /** Subscribe to incoming bytes. Returns an unsubscribe function. */
  onData(listener: (bytes: Uint8Array) => void): () => void;
}

export interface DriveFile {
  /** Path relative to the drive root, `/`-separated. */
  path: string;
  size: number;
}

/** A device mounted as a drive (USB mass storage). */
export interface FileTransport {
  readonly kind: 'files';
  readonly rootName?: string;
  /** Ask the user to pick the device's drive/folder. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  list(): Promise<DriveFile[]>;
  read(path: string): Promise<Uint8Array>;
  /** Only if the drive was opened read-write. */
  write?(path: string, bytes: Uint8Array): Promise<void>;
}

export interface BleOptions {
  serviceUuid: string;
  rxUuid: string;
  txUuid: string;
  namePrefix: string;
}

/** A Bluetooth device found nearby, or picked in the browser's chooser. */
export interface BlePeer {
  id: string;
  name: string;
  /** Signal strength, dBm (closer to 0: nearer). */
  rssi?: number;
  /** The profile it matched: this tells which model it is. */
  options: BleOptions;
  /** The platform's own handle on the device (the browser's `BluetoothDevice`). */
  handle?: unknown;
}

/**
 * Factories a platform must (or may) provide. To find a Bluetooth device, a
 * platform has either `bleScan` (iOS, Android: the app lists the devices) or
 * `blePick` (browser: its own chooser).
 */
export interface TransportFactories {
  ble?: (peer: BlePeer) => PacketTransport;
  /**
   * Report the devices around that match one of `wanted`, each once and
   * again when its signal changes. Returns a function that stops the search.
   */
  bleScan?: (wanted: BleOptions[], onFound: (peer: BlePeer) => void, onError: (e: Error) => void) => () => void;
  /** Ask the user to pick a device that matches one of `wanted`. */
  blePick?: (wanted: BleOptions[]) => Promise<BlePeer>;
  usbFiles?: () => FileTransport;
}

/** The profile of `wanted` a device named `name` matches. */
export function matchBle(wanted: BleOptions[], name: string): BleOptions | undefined {
  return wanted.find((o) => name.startsWith(o.namePrefix));
}
