import { loadCore } from '../wasm';
import type { PacketTransport } from '../transport/types';
import type { ActivityRef, Capabilities, Device, FileKind } from './types';

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
  TransferBegin: 0x10,
  TransferChunk: 0x11,
  TransferEnd: 0x12,
  TransferAbort: 0x13,
  DeviceInfo: 0x81,
  ActivityEntry: 0x82,
  ActivityChunk: 0x83,
  EndOfList: 0x84,
  TransferReady: 0x90,
  TransferAck: 0x91,
  TransferResend: 0x92,
  Ok: 0xf0,
  Error: 0xff,
} as const;

/** Keep in sync with crates/protocol-cc600/src/transfer.rs `Kind`. */
const FILE_KIND: Record<FileKind, number> = { route: 1, map: 2 };

/** Keep in sync with crates/protocol-cc600/src/transfer.rs `ErrorCode`. */
const DEVICE_ERRORS: Record<number, string> = {
  1: 'Le compteur a refusé la demande',
  2: 'Pas assez de place sur le compteur',
  3: 'Le compteur a perdu le transfert en cours',
  4: 'Le fichier est arrivé incomplet',
  5: 'Le fichier a été abîmé pendant l’envoi : renvoyez-le',
  6: 'Le compteur est occupé (sortie en cours ?)',
  7: 'Le compteur n’a pas pu écrire le fichier',
};

function deviceError(payload: Uint8Array): Error {
  const known = payload.length === 1 ? DEVICE_ERRORS[payload[0]] : undefined;
  return new Error(known ?? `Erreur du compteur (${[...payload].join(',')})`);
}

const FIT_EPOCH_OFFSET = 631_065_600;
const CHUNK = 512;
/** File bytes per `TransferChunk`: the frame (+11 bytes) fits a 255-byte BLE packet. */
const TRANSFER_CHUNK = 240;
const TRANSFER_MAX_STALLS = 3;

export interface Cc600Timing {
  /** A request without answer fails after this long. */
  requestMs: number;
  /** A transfer without any answer for this long asks the device where it is (`TransferBegin` again). */
  stallMs: number;
}

const TIMING: Cc600Timing = { requestMs: 10_000, stallMs: 5_000 };

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
  /** Frames no request waits for (acks of a file transfer). */
  private onEvent?: (f: Frame) => void;
  private unsubscribe?: () => void;

  constructor(
    private readonly transport: PacketTransport,
    private readonly timing: Cc600Timing = TIMING,
  ) {}

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

  async uploadFile(kind: FileKind, bytes: Uint8Array, onProgress?: (r: number) => void): Promise<void> {
    const core = await loadCore();
    const begin = core.cc600TransferBegin(FILE_KIND[kind], bytes);
    const sender = new core.Cc600Sender(bytes.length);
    let failure: Error | undefined;
    let pending = false;
    let wake: (() => void) | undefined;
    this.onEvent = (f) => {
      if (f.op === Op.TransferAck) {
        sender.ack(f.payload);
        onProgress?.(sender.permille() / 1000);
      } else if (f.op === Op.TransferResend) {
        sender.resend(f.payload);
      } else if (f.op === Op.Error) {
        failure = deviceError(f.payload);
      }
      pending = true;
      wake?.();
    };
    // Resolves true on any answer of the device, false after `ms` of silence.
    const answer = (ms: number) =>
      new Promise<boolean>((resolve) => {
        if (pending) return resolve(true);
        const timer = setTimeout(() => resolve(false), ms);
        wake = () => {
          clearTimeout(timer);
          resolve(true);
        };
      }).finally(() => {
        wake = undefined;
        pending = false;
      });
    // Also how a stalled transfer resumes: the device says where it is.
    const start = async () => {
      const ready = await this.request(Op.TransferBegin, begin, [Op.TransferReady]);
      sender.ready(ready.payload);
      onProgress?.(sender.permille() / 1000);
    };
    try {
      await start();
      for (let stalls = 0; !sender.done(); ) {
        for (let c = sender.nextChunk(TRANSFER_CHUNK); c; c = sender.nextChunk(TRANSFER_CHUNK)) {
          const [offset, length] = c;
          await this.send(Op.TransferChunk, core.cc600TransferChunk(offset, bytes.subarray(offset, offset + length)));
        }
        if (failure) throw failure;
        if (sender.done()) break;
        if (await answer(this.timing.stallMs)) {
          stalls = 0;
        } else if (++stalls > TRANSFER_MAX_STALLS) {
          throw new Error('Le compteur ne répond plus. Relancez l’envoi : il reprendra où il s’est arrêté.');
        } else {
          await start();
        }
      }
      if (failure) throw failure;
      await this.request(Op.TransferEnd, new Uint8Array(), [Op.Ok]);
      onProgress?.(1);
    } finally {
      this.onEvent = undefined;
      sender.free();
    }
  }

  // ---- framing -------------------------------------------------------

  private nextSeq(): number {
    return (this.seq = (this.seq + 1) & 0xff);
  }

  private async send(op: number, payload: Uint8Array, seq = this.nextSeq()): Promise<void> {
    const core = await loadCore();
    await this.transport.send(core.cc600Encode(op, seq, payload));
  }

  private async request(op: number, payload: Uint8Array, expect: number[]): Promise<Frame> {
    const frames = await this.requestMany(op, payload, null, expect);
    return frames[0];
  }

  /** Collect frames for one request until `endOp` (or the first `expect`ed frame). */
  private requestMany(op: number, payload: Uint8Array, endOp: number | null, expect?: number[]): Promise<Frame[]> {
    return new Promise((resolve, reject) => {
      const frames: Frame[] = [];
      // Registered before sending (the answer may be quick) and always removed:
      // `seq` wraps, a stale waiter would take the answers of a later request.
      const seq = this.nextSeq();
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        this.waiters.delete(seq);
        if (error) reject(error);
        else resolve(frames);
      };
      const timeout = setTimeout(() => finish(new Error('Le compteur ne répond pas')), this.timing.requestMs);
      this.waiters.set(seq, (f) => {
        if (f.op === Op.Error) return finish(deviceError(f.payload));
        frames.push(f);
        if (endOp !== null ? f.op === endOp : expect?.includes(f.op)) finish();
      });
      this.send(op, payload, seq).catch(finish);
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
      const frame = { op: decoded.op, seq: decoded.seq, payload: Uint8Array.from(decoded.payload) };
      (this.waiters.get(decoded.seq) ?? this.onEvent)?.(frame);
    }
  }
}
