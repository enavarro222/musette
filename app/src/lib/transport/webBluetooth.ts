/// <reference types="web-bluetooth" />
import { allServices, matchBle, type BleOptions, type BlePeer, type GattTransport } from './types';

/** The browser's chooser, offering every device that matches one of `wanted`. */
export async function pickBle(wanted: BleOptions[]): Promise<BlePeer> {
  if (!WebGattTransport.isSupported()) {
    throw new Error('Web Bluetooth indisponible dans ce navigateur (essayez Chrome).');
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: wanted.map((o) => ({ namePrefix: o.namePrefix })),
    optionalServices: wanted.flatMap(allServices),
  });
  const name = device.name ?? '';
  const options = matchBle(wanted, name);
  if (!options) throw new Error(`Appareil non reconnu : ${name || device.id}`);
  return { id: device.id, name, options, handle: device };
}

/**
 * Web Bluetooth (Chrome, Edge, Samsung Internet; not Safari/iOS).
 *
 * Limitation: browsers do not remember devices by default, so the user picks
 * the device in the browser chooser (`pickBle`) at each session.
 */
export class WebGattTransport implements GattTransport {
  readonly kind = 'gatt' as const;
  peerName?: string;
  /** The browser does not tell the MTU: conservative. TODO: negotiate a larger one with the firmware. */
  readonly maxWrite = 20;

  private server?: BluetoothRemoteGATTServer;
  private chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private listeners = new Set<(characteristic: string, bytes: Uint8Array) => void>();

  constructor(private readonly peer: BlePeer) {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    if (!WebGattTransport.isSupported()) {
      throw new Error('Web Bluetooth indisponible dans ce navigateur (essayez Chrome).');
    }
    const device = this.peer.handle as BluetoothDevice;
    this.peerName = this.peer.name;
    this.server = await device.gatt!.connect();
  }

  async disconnect(): Promise<void> {
    for (const c of this.chars.values()) c.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.chars.clear();
    this.server?.disconnect();
  }

  async subscribe(service: string, characteristic: string): Promise<void> {
    const c = await this.characteristic(service, characteristic);
    c.addEventListener('characteristicvaluechanged', this.handleNotification);
    await c.startNotifications();
  }

  async write(service: string, characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void> {
    const c = await this.characteristic(service, characteristic);
    if (withResponse) await c.writeValueWithResponse(bytes.slice());
    else await c.writeValueWithoutResponse(bytes.slice());
  }

  onNotify(listener: (characteristic: string, bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async characteristic(service: string, characteristic: string): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.server) throw new Error('Non connecté');
    let c = this.chars.get(characteristic);
    if (!c) {
      c = await (await this.server.getPrimaryService(service)).getCharacteristic(characteristic);
      this.chars.set(characteristic, c);
    }
    return c;
  }

  private handleNotification = (event: Event) => {
    const c = event.target as BluetoothRemoteGATTCharacteristic;
    if (!c.value) return;
    const v = c.value;
    const bytes = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    this.listeners.forEach((l) => l(c.uuid.toLowerCase(), bytes));
  };
}
