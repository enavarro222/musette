/// <reference types="web-bluetooth" />
import { matchBle, type BleOptions, type BlePeer, type PacketTransport } from './types';

/**
 * Web Bluetooth transport (Chrome, Edge, Samsung Internet; not Safari/iOS).
 *
 * Limitation: browsers do not remember devices by default, so the user picks
 * the device in the browser chooser (`pickBle`) at each session.
 */
export class WebBluetoothTransport implements PacketTransport {
  readonly kind = 'packet' as const;
  peerName?: string;

  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private listeners = new Set<(bytes: Uint8Array) => void>();
  /** Conservative default; TODO: negotiate a larger MTU with the firmware. */
  private chunkSize = 20;

  constructor(private readonly peer: BlePeer) {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    if (!WebBluetoothTransport.isSupported()) {
      throw new Error('Web Bluetooth indisponible dans ce navigateur (essayez Chrome).');
    }
    const { serviceUuid, rxUuid, txUuid } = this.peer.options;
    this.device = this.peer.handle as BluetoothDevice;
    this.peerName = this.peer.name;
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(serviceUuid);
    const rx = await service.getCharacteristic(rxUuid);
    const tx = await service.getCharacteristic(txUuid);
    tx.addEventListener('characteristicvaluechanged', this.handleNotification);
    await tx.startNotifications();
    this.rx = rx;
    this.tx = tx;
  }

  async disconnect(): Promise<void> {
    this.tx?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.device?.gatt?.disconnect();
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error('Non connecté');
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      await this.rx.writeValueWithoutResponse(bytes.slice(i, i + this.chunkSize));
    }
  }

  onData(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this.listeners.forEach((l) => l(bytes));
  };
}

/** The browser's chooser, offering every device that matches one of `wanted`. */
export async function pickBle(wanted: BleOptions[]): Promise<BlePeer> {
  if (!WebBluetoothTransport.isSupported()) {
    throw new Error('Web Bluetooth indisponible dans ce navigateur (essayez Chrome).');
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: wanted.map((o) => ({ namePrefix: o.namePrefix })),
    optionalServices: wanted.map((o) => o.serviceUuid),
  });
  const name = device.name ?? '';
  const options = matchBle(wanted, name);
  if (!options) throw new Error(`Appareil non reconnu : ${name || device.id}`);
  return { id: device.id, name, options, handle: device };
}
