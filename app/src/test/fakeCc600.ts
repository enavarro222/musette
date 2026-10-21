import { loadCore, type Cc600Simulator, type SimulatorOptions } from '../lib/core';
import type { GattTransport } from '../lib/transport/types';

export interface FakeActivity {
  id: number;
  /** Unix seconds. */
  startTime: number;
  fit: Uint8Array;
}

export interface FakeOptions extends SimulatorOptions {
  activities?: FakeActivity[];
}

/**
 * A CC600 at the other end of a BLE link, in memory: the simulated CC600 of
 * the Rust core (`driver_cc600::sim`), whose transfers and settings go
 * through the firmware's own code. Writes come in packets of `maxWrite`
 * bytes; answers go out in 20-byte notifications, delivered asynchronously
 * like GATT notifications.
 */
export class FakeCc600 implements GattTransport {
  readonly kind = 'gatt' as const;
  readonly peerName = 'CC600 fake';
  /** The default BLE packet: frames are cut, the device reassembles them. */
  readonly maxWrite = 20;
  private sim?: Cc600Simulator;
  /** Where answers come from: the characteristic the app subscribed to. */
  private tx = '';
  private alive = true;
  private listener: (characteristic: string, bytes: Uint8Array) => void = () => {};

  constructor(private readonly options: FakeOptions = {}) {}

  async connect(): Promise<void> {
    if (!this.sim) {
      this.sim = (await loadCore()).cc600Simulator(this.options);
      for (const a of this.options.activities ?? []) this.sim.addActivity(a.id, a.startTime, a.fit);
    }
    this.alive = true;
  }

  /** The device (once connected). */
  get device(): Cc600Simulator {
    if (!this.sim) throw new Error('FakeCc600: connect() first');
    return this.sim;
  }

  async disconnect(): Promise<void> {
    this.cut();
  }

  /** The link drops: nothing passes any more, the device keeps its partial file. */
  cut(): void {
    this.alive = false;
    this.sim?.disconnect();
  }

  async subscribe(_service: string, characteristic: string): Promise<void> {
    this.tx = characteristic;
  }

  onNotify(listener: (characteristic: string, bytes: Uint8Array) => void): () => void {
    this.listener = listener;
    return () => (this.listener = () => {});
  }

  async write(_service: string, _characteristic: string, bytes: Uint8Array): Promise<void> {
    if (!this.alive) return;
    for (const frame of this.device.write(bytes)) this.notify(frame);
  }

  /** Notifications waiting to be delivered, in order. */
  private outbox: Uint8Array[] = [];

  private notify(frame: Uint8Array): void {
    const idle = this.outbox.length === 0;
    for (let i = 0; i < frame.length; i += 20) this.outbox.push(frame.slice(i, i + 20));
    if (idle) this.deliver();
  }

  /**
   * One notification per task, in order, as GATT delivers them. (A timer per
   * notification is not enough: React Native does not keep equal timers in
   * order.)
   */
  private deliver(): void {
    setTimeout(() => {
      const part = this.outbox.shift();
      if (part && this.alive) this.listener(this.tx, part);
      if (this.outbox.length) this.deliver();
    }, 0);
  }
}

/** A valid FIT file (header + `body` + CRC), as `fit::verify` wants it. */
export function fitFile(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(14 + body.length + 2);
  const v = new DataView(out.buffer);
  v.setUint8(0, 14);
  v.setUint8(1, 0x20);
  v.setUint16(2, 2132, true);
  v.setUint32(4, body.length, true);
  out.set(new TextEncoder().encode('.FIT'), 8);
  v.setUint16(12, fitCrc(out.subarray(0, 12)), true);
  out.set(body, 14);
  v.setUint16(14 + body.length, fitCrc(out.subarray(0, 14 + body.length)), true);
  return out;
}

const FIT_CRC = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];

function fitCrc(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    for (const nibble of [b & 0xf, b >> 4]) {
      const t = FIT_CRC[crc & 0xf];
      crc = ((crc >> 4) & 0x0fff) ^ t ^ FIT_CRC[nibble];
    }
  }
  return crc;
}
