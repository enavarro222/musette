/**
 * Transports move bytes; drivers (in Rust, via WASM) give them meaning.
 *
 * The web build provides Web Bluetooth and File System Access transports.
 * The mobile apps inject native implementations of the same interfaces
 * through `MusettePlatform` (see `src/app.ts`).
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

/** Factories a platform must (or may) provide. */
export interface TransportFactories {
  ble?: (options: BleOptions) => PacketTransport;
  usbFiles?: () => FileTransport;
}
