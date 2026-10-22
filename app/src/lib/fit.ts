/**
 * Reading a ride's FIT file: its records (about one a second) and its session
 * (the totals the device computed). Only the fields the app shows are kept;
 * the rest of the file is skipped by its definitions. The file was verified
 * (header, CRC) by the device's session before it was stored.
 */

/** One sample of the ride; undefined where the device wrote nothing (or the FIT "invalid" value). */
export interface FitRecord {
  /** Unix seconds. */
  time?: number;
  /** Degrees. */
  lat?: number;
  lon?: number;
  /** Metres. */
  altitude?: number;
  /** Metres from the start. */
  distance?: number;
  /** m/s. */
  speed?: number;
  heartRate?: number;
  cadence?: number;
  /** Watts. */
  power?: number;
  /** °C. */
  temperature?: number;
}

/** The totals of a session, as the device computed them. */
export interface FitSession {
  /** Unix seconds. */
  startTime?: number;
  /** Seconds, pauses included. */
  elapsedS?: number;
  /** Seconds the timer ran (pauses and auto-pause excluded). */
  timerS?: number;
  distanceM?: number;
  ascentM?: number;
  descentM?: number;
  /** m/s. */
  avgSpeed?: number;
  maxSpeed?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgPower?: number;
  maxPower?: number;
  /** kcal. */
  calories?: number;
  avgTemperature?: number;
}

export interface FitActivity {
  records: FitRecord[];
  /** The first session (a bike ride has one). */
  session?: FitSession;
}

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631_065_600;
const MESG_SESSION = 18;
const MESG_RECORD = 20;
const FIELD_TIMESTAMP = 253;

interface Field {
  num: number;
  size: number;
  type: number;
}

interface Definition {
  littleEndian: boolean;
  global: number;
  fields: Field[];
  /** Bytes of developer fields after the fields, skipped. */
  devSize: number;
}

const semicircles = 180 / 2 ** 31;

type Setter<T> = (m: T, v: number) => void;

/** Record fields: number → how it is stored. `enhanced_*` (78, 73) win over the short ones (2, 6). */
const RECORD: Record<number, Setter<FitRecord>> = {
  253: (r, v) => (r.time = v + FIT_EPOCH),
  0: (r, v) => (r.lat = v * semicircles),
  1: (r, v) => (r.lon = v * semicircles),
  2: (r, v) => (r.altitude ??= v / 5 - 500),
  78: (r, v) => (r.altitude = v / 5 - 500),
  3: (r, v) => (r.heartRate = v),
  4: (r, v) => (r.cadence = v),
  5: (r, v) => (r.distance = v / 100),
  6: (r, v) => (r.speed ??= v / 1000),
  73: (r, v) => (r.speed = v / 1000),
  7: (r, v) => (r.power = v),
  13: (r, v) => (r.temperature = v),
};

const SESSION: Record<number, Setter<FitSession>> = {
  2: (s, v) => (s.startTime = v + FIT_EPOCH),
  7: (s, v) => (s.elapsedS = v / 1000),
  8: (s, v) => (s.timerS = v / 1000),
  9: (s, v) => (s.distanceM = v / 100),
  11: (s, v) => (s.calories = v),
  14: (s, v) => (s.avgSpeed ??= v / 1000),
  124: (s, v) => (s.avgSpeed = v / 1000),
  15: (s, v) => (s.maxSpeed ??= v / 1000),
  125: (s, v) => (s.maxSpeed = v / 1000),
  16: (s, v) => (s.avgHeartRate = v),
  17: (s, v) => (s.maxHeartRate = v),
  18: (s, v) => (s.avgCadence = v),
  20: (s, v) => (s.avgPower = v),
  21: (s, v) => (s.maxPower = v),
  22: (s, v) => (s.ascentM = v),
  23: (s, v) => (s.descentM = v),
  57: (s, v) => (s.avgTemperature = v),
};

/** Integer base types: size, signed, invalid value. Other types (strings, floats) are skipped. */
const TYPES: Record<number, [number, boolean, number]> = {
  0: [1, false, 0xff],
  1: [1, true, 0x7f],
  2: [1, false, 0xff],
  3: [2, true, 0x7fff],
  4: [2, false, 0xffff],
  5: [4, true, 0x7fffffff],
  6: [4, false, 0xffffffff],
  10: [1, false, 0],
  11: [2, false, 0],
  12: [4, false, 0],
  13: [1, false, 0xff],
};

/** A field's value, undefined if invalid, not an integer, or an array (none of the fields read here is one). */
function value(v: DataView, at: number, f: Field, le: boolean): number | undefined {
  const t = TYPES[f.type & 0x1f];
  if (!t || t[0] !== f.size) return undefined;
  const [size, signed, invalid] = t;
  const u = size === 1 ? v.getUint8(at) : size === 2 ? v.getUint16(at, le) : v.getUint32(at, le);
  if (u === invalid) return undefined;
  return signed && u >= 2 ** (8 * size - 1) ? u - 2 ** (8 * size) : u;
}

const broken = () => new Error('Fichier FIT illisible');

/** The records and first session of a FIT activity file. Throws on a record cut short. */
export function decodeFit(bytes: Uint8Array): FitActivity {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12) throw broken();
  const start = v.getUint8(0);
  const end = Math.min(start + v.getUint32(4, true), bytes.length);
  const defs: (Definition | undefined)[] = [];
  const activity: FitActivity = { records: [] };
  let lastTime = 0;
  let at = start;
  const need = (n: number) => {
    if (at + n > end) throw broken();
  };
  while (at < end) {
    const h = v.getUint8(at++);
    let local: number;
    let compressedTime: number | undefined;
    if (h & 0x80) {
      // Compressed timestamp header: 5 bits of seconds after the last timestamp.
      const offset = h & 0x1f;
      lastTime = (lastTime - (lastTime & 0x1f)) + offset + (offset < (lastTime & 0x1f) ? 0x20 : 0);
      local = (h >> 5) & 0x03;
      compressedTime = lastTime;
    } else if (h & 0x40) {
      need(5);
      const littleEndian = v.getUint8(at + 1) === 0;
      const global = v.getUint16(at + 2, littleEndian);
      const n = v.getUint8(at + 4);
      at += 5;
      need(3 * n);
      const fields = Array.from({ length: n }, (_, i) => ({
        num: v.getUint8(at + 3 * i),
        size: v.getUint8(at + 3 * i + 1),
        type: v.getUint8(at + 3 * i + 2),
      }));
      at += 3 * n;
      let devSize = 0;
      if (h & 0x20) {
        need(1);
        const n = v.getUint8(at++);
        need(3 * n);
        for (let i = 0; i < n; i++) devSize += v.getUint8(at + 3 * i + 1);
        at += 3 * n;
      }
      defs[h & 0x0f] = { littleEndian, global, fields, devSize };
      continue;
    } else {
      local = h & 0x0f;
    }

    const def = defs[local];
    if (!def) throw broken();
    const record: FitRecord = {};
    const session: FitSession = {};
    if (compressedTime !== undefined) record.time = compressedTime + FIT_EPOCH;
    for (const f of def.fields) {
      need(f.size);
      const x = value(v, at, f, def.littleEndian);
      at += f.size;
      if (x === undefined) continue;
      if (f.num === FIELD_TIMESTAMP) lastTime = x;
      if (def.global === MESG_RECORD) RECORD[f.num]?.(record, x);
      else if (def.global === MESG_SESSION) SESSION[f.num]?.(session, x);
    }
    need(def.devSize);
    at += def.devSize;
    if (def.global === MESG_RECORD) activity.records.push(record);
    else if (def.global === MESG_SESSION) activity.session ??= session;
  }
  return activity;
}
