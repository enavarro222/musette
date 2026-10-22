import { describe, expect, it } from 'vitest';
import { fitActivity, type Sample } from '../test/fitActivity';
import { readRide } from './ride';

const T0 = 1_790_000_000;

/** 10 m/s north, climbing 1 m a second, a 60 s stop after `stopAt` s. */
function ride(n: number, stopAt = Infinity): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const moving = Math.min(i, stopAt);
    return {
      time: T0 + i + (i > stopAt ? 60 : 0),
      lat: 45 + moving * 9e-5,
      lon: 5,
      altitude: 200 + moving,
      distance: moving * 10,
      speed: i > stopAt ? 0 : 10,
      heartRate: i % 2 ? 140 : 150,
    };
  });
}

describe('ride summary', () => {
  it('takes the totals of the session', async () => {
    const totals = { startTime: T0, elapsedS: 500, timerS: 400, distanceM: 4000, ascentM: 321 };
    const { summary, track } = await readRide(fitActivity(ride(300), totals));
    expect(summary).toMatchObject({ startTime: T0, distanceM: 4000, ascentM: 321, elapsedS: 500, movingS: 400 });
    expect(summary.avgSpeed).toBe(10);
    expect(track.lats).toHaveLength(300);
  });

  it('computes them from the records without a session', async () => {
    const { summary, analysis } = await readRide(fitActivity(ride(301, 200)));
    expect(summary.startTime).toBe(T0);
    expect(summary.distanceM).toBe(2000);
    // 300 s of records and a 60 s gap: elapsed counts the gap, moving neither it nor the stop.
    expect(summary.elapsedS).toBe(360);
    expect(summary.movingS).toBe(200);
    expect(summary.avgSpeed).toBe(10);
    expect(summary.maxSpeed).toBe(10);
    expect(summary.avgHeartRate).toBeCloseTo(145, 1);
    expect(summary.maxHeartRate).toBe(150);
    expect(summary.ascentM).toBeCloseTo(analysis.ascentM);
    expect(summary.ascentM).toBeGreaterThan(190);
    expect(summary.avgPower).toBeUndefined();
  });
});
