import type { StoredActivity } from '../lib/storage';
import { duration, km, kmh } from './format';

const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/** When a ride started (or was copied, if the device did not say). */
export const rideDate = (a: StoredActivity) =>
  fmt.format(new Date((a.summary?.startTime ?? a.startTime ?? a.importedAt / 1000) * 1000));

/** A ride's line in the list: `52,3 km · 640 m D+ · 2 h 05 · 25,1 km/h`, or its size until read. */
export function rideLine(a: StoredActivity): string {
  const s = a.summary;
  if (!s) return `${a.deviceName} · ${(a.fit.byteLength / 1024).toFixed(0)} Ko`;
  return [
    `${km(s.distanceM)} km`,
    s.ascentM === undefined ? undefined : `${Math.round(s.ascentM)} m D+`,
    duration(s.movingS),
    s.avgSpeed === undefined ? undefined : `${kmh(s.avgSpeed)} km/h`,
  ]
    .filter(Boolean)
    .join(' · ');
}
