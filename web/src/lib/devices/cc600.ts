import { loadCore } from '../wasm';
import type { PacketTransport } from '../transport/types';
import type { ActivityRef, Capabilities, Device } from './types';

/** Keep in sync with crates/protocol-cc600/src/ble.rs */
export const CC600_BLE = {
  serviceUuid: '18fbbd9a-adda-4ef4-9635-befd2efbf8a3',
  rxUuid: 'c039ed02-4557-4b35-bc20-5c9320871456',
  txUuid: '1cd21602-4b05-4c39-b9be-8353dece8a3f',
  namePrefix: 'CC600',
};

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
} as const;

const FIT_EPOCH_OFFSET = 631_065_600;
const CHUNK = 512;

interface Frame {
  op: number;
  seq: number;
  payload: Uint8Array;
}

export class Cc600Device implements Device {
  readonly model = 'open-cc600' as const;
  readonly capabilities: Capabilities = {
    downloadActivities: true,
    uploadRoute: true,
    routeCorridorMap: true,
    climbsOnDevice: true,
    settings: true,
    sensors: true,
    wifiSync: true,
  };

  private seq = 0;
  private rxBuffer = new Uint8Array(0);
  private waiters = new Map<number, (f: Frame) => void>();
  private unsubscribe?: () => void;

  constructor(private readonly transport: PacketTransport) {}

  get name(): string {
    return this.transport.peerName ?? 'CC600';
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    this.unsubscribe = this.transport.onData((b) => void this.onBytes(b));
    await this.request(Op.Hello, new Uint8Array(), [Op.DeviceInfo]);
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    await this.transport.disconnect();
  }

  async listActivities(): Promise<ActivityRef[]> {
    const frames = await this.requestMany(Op.ListActivities, new Uint8Array(), Op.EndOfList);
    return frames
      .filter((f) => f.op === Op.ActivityEntry)
      .map((f) => {
        const v = new DataView(f.payload.buffer, f.payload.byteOffset, f.payload.byteLength);
        return {
          id: String(v.getUint32(0, true)),
          startTime: v.getUint32(4, true) + FIT_EPOCH_OFFSET,
          size: v.getUint32(8, true),
          synced: v.getUint8(12) !== 0,
        };
      });
  }

  async downloadActivity(ref: ActivityRef, onProgress?: (r: number) => void): Promise<Uint8Array> {
    const size = ref.size ?? 0;
    const out = new Uint8Array(size);
    for (let offset = 0; offset < size; ) {
      const req = new Uint8Array(10);
      const v = new DataView(req.buffer);
      v.setUint32(0, Number(ref.id), true);
      v.setUint32(4, offset, true);
      v.setUint16(8, Math.min(CHUNK, size - offset), true);
      const f = await this.request(Op.ReadActivity, req, [Op.ActivityChunk]);
      if (f.payload.length === 0) throw new Error('Transfert interrompu');
      out.set(f.payload, offset);
      offset += f.payload.length;
      onProgress?.(offset / size);
    }
    const core = await loadCore();
    core.verifyFit(out); // throws if truncated/corrupted
    return out;
  }

  async acknowledgeActivity(ref: ActivityRef, fit: Uint8Array): Promise<void> {
    // TODO: send the FIT CRC so the device can double-check before freeing.
    void fit;
    const req = new Uint8Array(6);
    new DataView(req.buffer).setUint32(0, Number(ref.id), true);
    await this.request(Op.AckActivity, req, [Op.Ok]);
  }

  // ---- framing -------------------------------------------------------

  private async send(op: number, payload: Uint8Array): Promise<number> {
    const core = await loadCore();
    const seq = (this.seq = (this.seq + 1) & 0xff);
    await this.transport.send(core.cc600Encode(op, seq, payload));
    return seq;
  }

  private async request(op: number, payload: Uint8Array, expect: number[]): Promise<Frame> {
    const frames = await this.requestMany(op, payload, null, expect);
    return frames[0];
  }

  /** Collect frames for one request until `endOp` (or the first `expect`ed frame). */
  private requestMany(op: number, payload: Uint8Array, endOp: number | null, expect?: number[]): Promise<Frame[]> {
    return new Promise((resolve, reject) => {
      const frames: Frame[] = [];
      const timeout = setTimeout(() => reject(new Error('Le compteur ne répond pas')), 10_000);
      void this.send(op, payload).then((seq) => {
        this.waiters.set(seq, (f) => {
          if (f.op === Op.Error) {
            clearTimeout(timeout);
            this.waiters.delete(seq);
            reject(new Error(`Erreur du compteur (${[...f.payload].join(',')})`));
            return;
          }
          frames.push(f);
          const done = endOp !== null ? f.op === endOp : expect?.includes(f.op);
          if (done) {
            clearTimeout(timeout);
            this.waiters.delete(seq);
            resolve(frames);
          }
        });
      }, reject);
    });
  }

  private async onBytes(bytes: Uint8Array): Promise<void> {
    const core = await loadCore();
    const merged = new Uint8Array(this.rxBuffer.length + bytes.length);
    merged.set(this.rxBuffer);
    merged.set(bytes, this.rxBuffer.length);
    this.rxBuffer = merged;
    for (;;) {
      const decoded = core.cc600Decode(this.rxBuffer) as
        | { op: number; seq: number; payload: number[]; consumed: number }
        | undefined;
      if (!decoded) return;
      this.rxBuffer = this.rxBuffer.slice(decoded.consumed);
      this.waiters.get(decoded.seq)?.({
        op: decoded.op,
        seq: decoded.seq,
        payload: Uint8Array.from(decoded.payload),
      });
    }
  }
}
