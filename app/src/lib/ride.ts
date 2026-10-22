import { loadCore, type ParsedRoute, type RouteAnalysis } from './core';
import { decodeFit, type FitActivity, type FitRecord } from './fit';

/**
 * What the ride list and the ride screen show. The device's own totals when
 * its file has a session (they match what it showed while riding), else
 * computed from the records.
 */
export interface RideSummary {
  /** Unix seconds. */
  startTime?: number;
  distanceM: number;
  ascentM?: number;
  descentM?: number;
  /** Seconds, pauses included. */
  elapsedS: number;
  /** Seconds moving (the device's timer). */
  movingS: number;
  /** m/s, over the moving time. */
  avgSpeed?: number;
  maxSpeed?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgPower?: number;
  maxPower?: number;
  calories?: number;
  avgTemperature?: number;
}

/** A ride read from its FIT file: its summary, its track and the track's analysis (profile, climbs). */
export interface Ride {
  summary: RideSummary;
  /** The records with a position; `eles` NaN where the altitude is missing. */
  track: ParsedRoute;
  analysis: RouteAnalysis;
}

/** Slower than this (m/s) is standing still, for the moving time computed from records. */
const MOVING_SPEED = 1;
/** A longer gap between records is a pause (the device stopped recording). */
const MAX_GAP_S = 10;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
// Not `Math.max(...xs)`: a long ride has tens of thousands of records.
const max = (xs: number[]) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : undefined);
const present = (records: FitRecord[], get: (r: FitRecord) => number | undefined) =>
  records.map(get).filter((x): x is number => x !== undefined);

export function rideTrack(records: FitRecord[]): ParsedRoute {
  const fixes = records.filter((r) => r.lat !== undefined && r.lon !== undefined && (r.lat !== 0 || r.lon !== 0));
  return {
    name: 'Sortie',
    lats: fixes.map((r) => r.lat!),
    lons: fixes.map((r) => r.lon!),
    eles: fixes.map((r) => r.altitude ?? NaN),
  };
}

/** Seconds moving: the gaps between records while faster than `MOVING_SPEED`, pauses left out. */
function movingTime(records: FitRecord[]): number {
  let moving = 0;
  for (let i = 1; i < records.length; i++) {
    const [a, b] = [records[i - 1], records[i]];
    if (a.time === undefined || b.time === undefined) continue;
    const dt = b.time - a.time;
    if (dt <= 0 || dt > MAX_GAP_S) continue;
    const speed =
      b.speed ?? (a.distance !== undefined && b.distance !== undefined ? (b.distance - a.distance) / dt : undefined);
    if (speed !== undefined && speed >= MOVING_SPEED) moving += dt;
  }
  return moving;
}

export function summarize(fit: FitActivity, analysis: RouteAnalysis): RideSummary {
  const { records } = fit;
  const s = fit.session ?? {};
  const times = present(records, (r) => r.time);
  const distanceM = s.distanceM ?? max(present(records, (r) => r.distance)) ?? analysis.distanceM;
  const movingS = s.timerS ?? movingTime(records);
  const cadences = present(records, (r) => r.cadence).filter((c) => c > 0);
  return {
    startTime: s.startTime ?? times[0],
    distanceM,
    ascentM: s.ascentM ?? (analysis.profile.length ? analysis.ascentM : undefined),
    descentM: s.descentM,
    elapsedS: s.elapsedS ?? (times.length ? times[times.length - 1] - times[0] : 0),
    movingS,
    avgSpeed: s.avgSpeed ?? (movingS > 0 ? distanceM / movingS : undefined),
    maxSpeed: s.maxSpeed ?? max(present(records, (r) => r.speed)),
    avgHeartRate: s.avgHeartRate ?? mean(present(records, (r) => r.heartRate)),
    maxHeartRate: s.maxHeartRate ?? max(present(records, (r) => r.heartRate)),
    avgCadence: s.avgCadence ?? mean(cadences),
    avgPower: s.avgPower ?? mean(present(records, (r) => r.power)),
    maxPower: s.maxPower ?? max(present(records, (r) => r.power)),
    calories: s.calories,
    avgTemperature: s.avgTemperature ?? mean(present(records, (r) => r.temperature)),
  };
}

/** Read a ride's FIT file. Throws if it cannot be read. */
export async function readRide(fit: Uint8Array): Promise<Ride> {
  const activity = decodeFit(fit);
  const track = rideTrack(activity.records);
  const analysis = (await loadCore()).analyzeRoute(track.lats, track.lons, track.eles);
  return { summary: summarize(activity, analysis), track, analysis };
}
