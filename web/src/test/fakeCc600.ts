import * as core from '../lib/wasm/pkg/musette_wasm';
import type { PacketTransport } from '../lib/transport/types';

/** Keep in sync with crates/protocol-cc600/src/lib.rs `Op`. */
const Op = {
  Hello: 0x01,
  ListActivities: 0x02,
  ReadActivity: 0x03,
  AckActivity: 0x04,
  DeviceInfo: 0x81,
  ActivityEntry: 0x82,
  ActivityChunk: 0x83,
  EndOfList: 0x84,
  Ok: 0xf0,
  Error: 0xff,
};

const FIT_EPOCH_OFFSET = 631_065_600;
/** Bytes per notification, as with the default BLE MTU. */
const NOTIFY = 20;

export interface FakeActivity {
  id: number;
  /** Unix seconds. */
  startTime: number;
  fit: Uint8Array;
}

export interface FakeOptions {
  window?: number;
  free?: number;
  activities?: FakeActivity[];
  /** Lose the n-th `TransferChunk` (1-based, counted over the fake's life). */
  dropChunk?: (n: number) => boolean;
  /** Lose the n-th `TransferAck`. */
  dropAck?: (n: number) => boolean;
}

/**
 * A CC600 at the other end of a BLE link, in memory. File transfers go to the
 * real device-side state machine (`Cc600Receiver`, Rust). Answers are split in
 * 20-byte notifications and delivered asynchronously, like GATT notifications.
 */
export class FakeCc600 implements PacketTransport {
  readonly kind = 'packet' as const;
  readonly peerName = 'CC600 fake';
  readonly receiver: core.Cc600Receiver;
  /** Activity ids acknowledged by the app, in order. */
  readonly acked: number[] = [];
  /** File bytes received in `TransferChunk`s, lost ones included. */
  chunkBytes = 0;
  private chunks = 0;
  private acks = 0;
  private alive = true;
  private listener: (b: Uint8Array) => void = () => {};

  constructor(private readonly options: FakeOptions = {}) {
    this.receiver = new core.Cc600Receiver(options.window ?? 2048, options.free ?? 1 << 20);
  }

  async connect(): Promise<void> {
    this.alive = true;
  }

  async disconnect(): Promise<void> {
    this.cut();
  }

  /** The link drops: nothing passes any more, the device keeps its partial file. */
  cut(): void {
    this.alive = false;
    this.receiver.disconnect();
  }

  onData(listener: (bytes: Uint8Array) => void): () => void {
    this.listener = listener;
    return () => (this.listener = () => {});
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.alive) return;
    const f = core.cc600Decode(bytes) as { op: number; seq: number; payload: number[]; consumed: number };
    if (f.consumed !== bytes.length) throw new Error('one frame per send expected');
    const payload = Uint8Array.from(f.payload);
    const v = new DataView(payload.buffer);
    const reply = (op: number, p: Uint8Array = new Uint8Array()) => this.notify(core.cc600Encode(op, f.seq, p));
    switch (f.op) {
      case Op.Hello:
        return reply(Op.DeviceInfo);
      case Op.ListActivities: {
        for (const a of this.options.activities ?? []) {
          const e = new DataView(new ArrayBuffer(13));
          e.setUint32(0, a.id, true);
          e.setUint32(4, a.startTime - FIT_EPOCH_OFFSET, true);
          e.setUint32(8, a.fit.length, true);
          e.setUint8(12, this.acked.includes(a.id) ? 1 : 0);
          reply(Op.ActivityEntry, new Uint8Array(e.buffer));
        }
        return reply(Op.EndOfList);
      }
      case Op.ReadActivity: {
        const a = this.options.activities?.find((x) => x.id === v.getUint32(0, true));
        if (!a) return reply(Op.Error, Uint8Array.of(1));
        const offset = v.getUint32(4, true);
        return reply(Op.ActivityChunk, a.fit.slice(offset, offset + v.getUint16(8, true)));
      }
      case Op.AckActivity:
        this.acked.push(v.getUint32(0, true));
        return reply(Op.Ok);
    }
    if (f.op === 0x11) {
      this.chunkBytes += payload.length - 4;
      if (this.options.dropChunk?.(++this.chunks)) return;
    }
    const answer = this.receiver.handle(f.op, payload);
    if (!answer) return;
    if (answer[0] === 0x91 && this.options.dropAck?.(++this.acks)) return;
    reply(answer[0], answer.subarray(1));
  }

  private notify(frame: Uint8Array): void {
    for (let i = 0; i < frame.length; i += NOTIFY) {
      const part = frame.slice(i, i + NOTIFY);
      setTimeout(() => this.alive && this.listener(part), 0);
    }
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
