import { describe, expect, it, vi } from 'vitest';
import type { StoredRoute } from './storage';

const stored = new Map<string, StoredRoute>();

vi.mock('./storage', async () => ({
  newRouteId: (await import('./storage.types')).newRouteId,
  routes: { put: async (r: StoredRoute) => void stored.set(r.id, r) },
}));

const { importRoute } = await import('./library');

const gpx = (name: string) => `<gpx><trk><name>${name}</name><trkseg>
  <trkpt lat="45" lon="5"><ele>200</ele></trkpt>
  <trkpt lat="45.01" lon="5"><ele>260</ele></trkpt>
</trkseg></trk></gpx>`;

describe('route library', () => {
  it('stores the GPX as imported, with its name and size', async () => {
    const r = await importRoute(gpx('Col'), 1000);
    expect(stored.get(r.id)).toEqual(r);
    expect(r).toMatchObject({ name: 'Col', importedAt: 1000, gpx: gpx('Col') });
    expect(r.distanceM).toBeGreaterThan(1100);
    expect(r.distanceM).toBeLessThan(1120);
  });

  it('gives each import its own id', async () => {
    const a = await importRoute(gpx('A'));
    const b = await importRoute(gpx('A'));
    expect(a.id).not.toBe(b.id);
  });

  it('stores nothing from an unreadable file', async () => {
    const before = stored.size;
    await expect(importRoute('<gpx></gpx>')).rejects.toThrow('Le GPX ne contient pas de trace');
    expect(stored.size).toBe(before);
  });
});
