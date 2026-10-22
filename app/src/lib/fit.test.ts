import { describe, expect, it } from 'vitest';
import { fitFile } from '../test/fakeCc600';
import { fitActivity, type Sample } from '../test/fitActivity';
import { decodeFit } from './fit';

const T0 = 1_790_000_000;
const sample = (i: number): Sample => ({
  time: T0 + i,
  lat: 45 + i * 1e-4,
  lon: 5,
  altitude: 200 + i,
  distance: i * 11.1,
  speed: 11.1,
  heartRate: 120 + i,
});

describe('FIT reading', () => {
  it('reads records and the session', () => {
    const totals = { startTime: T0, elapsedS: 9.5, timerS: 9, distanceM: 99.9, ascentM: 9 };
    const a = decodeFit(fitActivity(Array.from({ length: 10 }, (_, i) => sample(i)), totals));
    expect(a.records).toHaveLength(10);
    const r = a.records[3];
    expect(r.time).toBe(T0 + 3);
    expect(r.lat).toBeCloseTo(45.0003, 6);
    expect(r.lon).toBeCloseTo(5, 6);
    expect(r.altitude).toBe(203);
    expect(r.distance).toBeCloseTo(33.3, 9);
    expect(r.speed).toBe(11.1);
    expect(r.heartRate).toBe(123);
    expect(r.power).toBeUndefined();
    expect(a.session).toEqual(totals);
  });

  it('reads compressed timestamps and skips invalid values', () => {
    const t = 0x1000_001e;
    const body = [0x40, 0, 0, 20, 0, 2, 253, 4, 0x86, 3, 1, 0x02];
    // Normal header, no heart rate (0xff).
    body.push(0x00, 0x1e, 0x00, 0x00, 0x10, 0xff);
    // Local 1, heart rate only, for compressed headers: +3 s rolls the 5 bits over (0x1e -> 0x01).
    body.push(0x41, 0, 0, 20, 0, 1, 3, 1, 0x02);
    body.push(0x80 | (1 << 5) | 0x01, 150);
    const a = decodeFit(fitFile(Uint8Array.from(body)));
    expect(a.records).toEqual([{ time: t + 631_065_600 }, { time: t + 3 + 631_065_600, heartRate: 150 }]);
  });

  it('skips developer fields and other messages', () => {
    const body = [0x40, 0, 0, 0, 0, 1, 0, 1, 0x00, 0x00, 4];
    body.push(0x60, 0, 0, 20, 0, 1, 3, 1, 0x02, 1, 0, 2, 0);
    body.push(0x00, 140, 0xaa, 0xbb);
    const a = decodeFit(fitFile(Uint8Array.from(body)));
    expect(a.records).toEqual([{ heartRate: 140 }]);
    expect(a.session).toBeUndefined();
  });

  it('refuses a record without definition, or cut short', () => {
    expect(() => decodeFit(fitFile(Uint8Array.of(0x03, 1, 2)))).toThrow('Fichier FIT illisible');
    expect(() => decodeFit(fitFile(Uint8Array.of(0x40, 0, 0, 20, 0, 1, 3, 1, 0x02, 0x00)))).toThrow();
  });
});
