import { fitFile } from './fakeCc600';

/** One second of a synthetic ride (no real ride, so no real position, is committed). */
export interface Sample {
  /** Unix seconds. */
  time: number;
  lat: number;
  lon: number;
  altitude: number;
  distance: number;
  speed: number;
  heartRate: number;
}

export interface Totals {
  startTime: number;
  elapsedS: number;
  timerS: number;
  distanceM: number;
  ascentM: number;
}

const FIT_EPOCH = 631_065_600;
const sc = (deg: number) => Math.round(deg * (2 ** 31 / 180));

/**
 * A FIT file of `samples` as records (little endian) and, if given, a
 * session with these totals (big endian: both byte orders are read).
 */
export function fitActivity(samples: Sample[], totals?: Totals): Uint8Array {
  const out: number[] = [];
  const put = (n: number, size: number, le = true) => {
    const b = new DataView(new ArrayBuffer(4));
    if (size === 1) b.setUint8(0, n);
    else if (size === 2) b.setUint16(0, n, le);
    else b.setUint32(0, n >>> 0, le);
    out.push(...new Uint8Array(b.buffer, 0, size));
  };
  // Record definition, local 0: timestamp, lat, lon, altitude, distance, speed, heart rate.
  out.push(0x40, 0, 0, 20, 0, 7, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84, 5, 4, 0x86, 6, 2, 0x84, 3, 1, 0x02);
  for (const s of samples) {
    out.push(0x00);
    put(s.time - FIT_EPOCH, 4);
    put(sc(s.lat), 4);
    put(sc(s.lon), 4);
    put(Math.round((s.altitude + 500) * 5), 2);
    put(Math.round(s.distance * 100), 4);
    put(Math.round(s.speed * 1000), 2);
    put(s.heartRate, 1);
  }
  if (totals) {
    out.push(0x41, 0, 1, 0, 18, 5, 2, 4, 0x86, 7, 4, 0x86, 8, 4, 0x86, 9, 4, 0x86, 22, 2, 0x84);
    out.push(0x01);
    put(totals.startTime - FIT_EPOCH, 4, false);
    put(Math.round(totals.elapsedS * 1000), 4, false);
    put(Math.round(totals.timerS * 1000), 4, false);
    put(Math.round(totals.distanceM * 100), 4, false);
    put(totals.ascentM, 2, false);
  }
  return fitFile(Uint8Array.from(out));
}

/**
 * The simulated CC600's ride: a made-up 30 km loop (one sample every 2 s,
 * slower uphill) over a hill of 250 m, with heart rate.
 */
export function demoRide(startTime: number): Uint8Array {
  const n = 2150;
  const [lat0, lon0, r] = [45.9, 6.15, 0.043];
  let distance = 0;
  const samples = Array.from({ length: n }, (_, i): Sample => {
    const a = (i / n) * 2 * Math.PI;
    const hill = Math.max(0, Math.sin(a * 2 - 0.6));
    const speed = 8.5 - 4 * hill;
    distance += 2 * speed;
    return {
      time: startTime + 2 * i,
      lat: lat0 + r * Math.sin(a),
      lon: lon0 + (r / Math.cos((lat0 * Math.PI) / 180)) * Math.cos(a),
      altitude: 450 + 250 * hill ** 2 + 3 * Math.sin(i / 7),
      distance,
      speed,
      heartRate: Math.round(118 + 40 * hill),
    };
  });
  return fitActivity(samples);
}
