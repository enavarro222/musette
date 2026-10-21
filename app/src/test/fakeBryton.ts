import type { GattTransport } from '../lib/transport/types';

/**
 * A Rider 750 over Bluetooth, as seen on a real one (OS R089): device info,
 * handshake after "new app", ride list, file ranges, acknowledgement, route
 * upload with its long-command name, settings. Frames are the device's;
 * docs/drivers/bryton-ble.md §0 has the captures.
 */

/** Keep in sync with crates/driver-bryton/src/ble.rs `uuid`. */
const COMMAND = '454d2288-a122-058d-9b42-9d0f3772af82';
const DATA = '454d1188-a122-058d-9b42-9d0f3772af82';
const SETTING = '50b81188-c2de-a994-094d-340090726877';

/** Data frames the device sends: 20 bytes, and 150 after the handshake for ranges. */
const SMALL = 20;
const LARGE = 150;

export interface FakeRide {
  /** `yyMMddHHmmss`. */
  id: string;
  fit: Uint8Array;
}

export interface FakeBrytonOptions {
  rides?: FakeRide[];
  /** Answers to setting gets, by `cmd:args` (`27:2` for bike 2's auto pause): the payload. */
  settings?: Record<string, number[]>;
  /** Refuse setting sets of this command (status 0). */
  refuseSet?: number;
}

const control = (type: number, seq: number) => (type << 5) | ((seq & 7) << 2);
const sum8 = (b: number[]) => b.reduce((s, x) => (s + x) & 0xff, 0);
const setting = (cmd: number, type: number, payload: number[]) => {
  const b = [cmd, type, ...payload];
  return Uint8Array.from([...b, sum8(b)]);
};

/** Seconds since 1970 of `yyMMddHHmmss`, counted as UTC (the device's file id). */
function fileId(id: string): number {
  const [y, mo, d, h, mi, s] = (id.match(/../g) ?? []).map(Number);
  return Date.UTC(2000 + y, mo - 1, d, h, mi, s) / 1000;
}

/** Start frame, data frames, end frame with the byte sum. */
function transfer(cmd: number, data: Uint8Array, frame: number, extra: number[] = []): Uint8Array[] {
  const room = frame - 2;
  const n = Math.max(1, Math.ceil(data.length / room));
  const last = data.length - (n - 1) * room;
  const out = [Uint8Array.from([0, 0, n >> 8, n & 0xff, last, cmd, 0, ...extra])];
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const part = data.subarray((i - 1) * room, i * room);
    total += part.reduce((s, x) => s + x, 0);
    out.push(Uint8Array.from([i >> 8, i & 0xff, ...part]));
  }
  out.push(Uint8Array.from([(n + 1) >> 8, (n + 1) & 0xff, 0, total >>> 24, (total >> 16) & 0xff, (total >> 8) & 0xff, total & 0xff]));
  return out;
}

export class FakeBryton implements GattTransport {
  readonly kind = 'gatt' as const;
  readonly peerName = 'Rider750';

  rides: FakeRide[];
  settings: Record<string, number[]>;
  /** Every frame written by the app, with its characteristic. */
  written: { characteristic: string; bytes: Uint8Array }[] = [];
  /** Routes imported (after their name), name → received bytes (gzip). */
  routes = new Map<string, Uint8Array>();
  connected = false;

  private listeners = new Set<(characteristic: string, bytes: Uint8Array) => void>();
  private pending?: Uint8Array[];
  private upload?: { seq: number; frames: Uint8Array[]; data: number[] };
  private received: number[] = [];
  private name?: { chunks: number; length: number; bytes: number[] };

  constructor(private readonly options: FakeBrytonOptions = {}) {
    this.rides = [...(options.rides ?? [])];
    this.settings = { ...(options.settings ?? {}) };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async subscribe(): Promise<void> {}

  onNotify(listener: (characteristic: string, bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async write(_service: string, characteristic: string, bytes: Uint8Array): Promise<void> {
    this.written.push({ characteristic, bytes: bytes.slice() });
    if (characteristic === COMMAND) this.onCommand(bytes);
    else if (characteristic === DATA) this.onData(bytes);
    else if (characteristic === SETTING) this.onSetting(bytes);
  }

  /** Frames written to a characteristic (`command`, `data` or `setting`). */
  sent(channel: 'command' | 'data' | 'setting'): number[][] {
    const c = { command: COMMAND, data: DATA, setting: SETTING }[channel];
    return this.written.filter((w) => w.characteristic === c).map((w) => [...w.bytes]);
  }

  private notify(characteristic: string, bytes: Uint8Array | number[]) {
    const b = Uint8Array.from(bytes);
    setTimeout(() => this.listeners.forEach((l) => l(characteristic, b)), 0);
  }

  private onCommand(b: Uint8Array) {
    const [cmd, ctrl] = b;
    const type = ctrl >> 5;
    const seq = (ctrl >> 2) & 7;
    if (type === 0) {
      const ok = [cmd, control(1, seq), 2];
      if (cmd === 6) {
        const info = new TextEncoder().encode('UD1902000000000000\0IV089.013.0005.03.011.001\0MNRider750\0CPAFF,0\0');
        this.pending = transfer(6, info, SMALL);
      } else if (cmd === 11) {
        const list: number[] = [];
        for (const r of this.rides) {
          const e = new Uint8Array(36);
          const v = new DataView(e.buffer);
          e[0] = 19;
          v.setUint32(1, fileId(r.id));
          v.setUint32(5, 3600);
          v.setUint32(9, 25_000);
          e[18] = 2;
          list.push(...e);
        }
        if (this.rides.length === 0) return this.notify(COMMAND, [cmd, control(1, seq), 6]);
        const n = this.rides.length;
        this.pending = transfer(11, Uint8Array.from(list), SMALL, [n >> 8, n & 0xff]);
      } else if (cmd === 17) {
        const v = new DataView(b.buffer, b.byteOffset);
        const id = v.getUint32(2);
        const offset = v.getUint32(7);
        const length = v.getUint32(11);
        const ride = this.rides.find((r) => fileId(r.id) === id);
        if (!ride) return this.notify(COMMAND, [cmd, control(1, seq), 0]);
        let answer = ride.fit.subarray(offset, offset + length);
        if (offset === 0 && length === 4) {
          // The size query: the file size, big-endian.
          answer = new Uint8Array(4);
          new DataView(answer.buffer).setUint32(0, ride.fit.length);
        }
        this.pending = transfer(17, answer, LARGE);
      } else if (cmd === 16) {
        this.upload = { seq, frames: [], data: [] };
      }
      return this.notify(COMMAND, ok);
    }
    if (type === 2) {
      const code = b[2];
      // Cmds 6 and 11 send their data after action 3, ranges after action 5.
      if (this.pending && ((code === 3 && (cmd === 6 || cmd === 11)) || (code === 5 && cmd === 17))) {
        const frames = this.pending;
        this.pending = undefined;
        frames.forEach((f) => this.notify(DATA, f));
      }
    }
  }

  private onData(b: Uint8Array) {
    const u = this.upload;
    if (!u) return;
    const index = (b[0] << 8) | b[1];
    if (index === 0) {
      u.frames = [];
      u.data = [];
      return;
    }
    if (b.length === 7 && index === u.frames.length + 1) {
      const total = u.data.reduce((s, x) => s + x, 0);
      const sum = new DataView(b.buffer, b.byteOffset).getUint32(3);
      if (sum !== total) return this.notify(COMMAND, [16, control(2, u.seq), 1]);
      // A package: [offset u32 BE][total u32 BE][data].
      this.received.push(...u.data.slice(8));
      return this.notify(COMMAND, [16, control(2, u.seq), 3, 0, 0]);
    }
    u.frames.push(b);
    u.data.push(...b.subarray(2));
  }

  private onSetting(b: Uint8Array) {
    if (b.length === 2) return; // the app's ack
    const [cmd, type] = b;
    const payload = [...b.subarray(2, b.length - 1)];
    if (cmd === 47) {
      this.notify(SETTING, [47, 10]);
      return this.notify(SETTING, [0x34, 1, 0x48, 0xf4, 1, 0, 0, 0x50, 0x96, 0, 0, 0, 0x57, 1, 0xb0]);
    }
    if (cmd === 49 && type === 1) {
      this.notify(SETTING, [49, 10]);
      const [k] = payload;
      if (k === 0) {
        this.name = { chunks: payload[1] - 1, length: payload[2], bytes: [] };
      } else if (this.name) {
        this.name.bytes.push(...payload.slice(1));
        if (k === this.name.chunks) {
          const name = new TextDecoder().decode(Uint8Array.from(this.name.bytes.slice(0, this.name.length)));
          this.routes.set(name, Uint8Array.from(this.received));
          this.received = [];
          this.name = undefined;
          return;
        }
      }
      return this.notify(SETTING, setting(49, 2, [k + 1]));
    }
    if (cmd === 51) {
      const id = new DataView(Uint8Array.from(payload).buffer).getUint32(0, true);
      this.rides = this.rides.filter((r) => fileId(r.id) !== id);
      return this.notify(SETTING, [51, 10]);
    }
    if (type === 2) {
      // Unknown: the device echoes the arguments, with no value.
      const answer = this.settings[`${cmd}:${payload.join(',')}`] ?? payload;
      return this.notify(SETTING, setting(cmd, 1, answer));
    }
    if (type === 1) {
      if (cmd === this.options.refuseSet) return this.notify(SETTING, [cmd, 0]);
      // Same layout as the get answer: per-bike sets start with the bike.
      const perBike = this.settings[`${cmd}:${payload[0]}`] !== undefined;
      this.settings[perBike ? `${cmd}:${payload[0]}` : `${cmd}:`] = payload;
      return this.notify(SETTING, [cmd, 10]);
    }
  }
}
