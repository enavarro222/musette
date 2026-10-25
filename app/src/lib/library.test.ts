import { describe, expect, it, vi } from 'vitest';
import type { StoredRoute } from './storage';

const stored = new Map<string, StoredRoute>();

vi.mock('./storage', async () => ({
  newRouteId: (await import('./storage.types')).newRouteId,
  routes: {
    put: vi.fn(async (r: StoredRoute) => void stored.set(r.id, r)),
    get: async (id: string) => stored.get(id),
  },
}));

const { importRoute, loadRoute, reverseRoute } = await import('./library');
const { routes } = await import('./storage');

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

  it('keeps the reversed direction and recalculates the profile and ascent, without changing the source GPX', async () => {
    const original = await importRoute(gpx('Col'), 1000);
    const before = (await loadRoute(original.id))!;
    const reversed = await reverseRoute(original.id);
    expect(reversed.route.lats).toEqual([45.01, 45]);
    expect(reversed.route.lons).toEqual([5, 5]);
    expect(reversed.route.eles).toEqual([260, 200]);
    expect(reversed.analysis.profile[0]).toBeGreaterThan(reversed.analysis.profile.at(-1)!);
    expect(reversed.analysis.ascentM).toBe(0);
    expect(reversed.analysis.distanceM).toBeCloseTo(before.analysis.distanceM, 1);
    expect(stored.get(original.id)).toEqual({ ...original, reversed: true, ascentM: 0, distanceM: reversed.analysis.distanceM });
    expect(await loadRoute(original.id)).toEqual(reversed);

    const restored = await reverseRoute(original.id);
    expect(restored).toEqual(before);
    expect(stored.get(original.id)?.gpx).toBe(original.gpx);
    expect(stored.get(original.id)?.ascentM).toBe(original.ascentM);
  });

  it('reverses the interior of a loop too, keeping a missing elevation with its point', async () => {
    const original = await importRoute(`<gpx><trk><trkseg>
      <trkpt lat="45" lon="5"><ele>200</ele></trkpt>
      <trkpt lat="45.01" lon="5.01"/>
      <trkpt lat="45.02" lon="5.02"><ele>260</ele></trkpt>
      <trkpt lat="45" lon="5"><ele>200</ele></trkpt>
    </trkseg></trk></gpx>`);
    const reversed = await reverseRoute(original.id);
    expect(reversed.route.lats).toEqual([45, 45.02, 45.01, 45]);
    expect(reversed.route.lons).toEqual([5, 5.02, 5.01, 5]);
    expect(reversed.route.eles).toEqual([200, 260, NaN, 200]);
  });

  it('leaves the kept direction unchanged if storage fails', async () => {
    const original = await importRoute(gpx('Col'));
    vi.mocked(routes.put).mockRejectedValueOnce(new Error('Stockage indisponible'));
    await expect(reverseRoute(original.id)).rejects.toThrow('Stockage indisponible');
    expect(stored.get(original.id)).toEqual(original);
    expect((await loadRoute(original.id))?.reversed).toBe(false);
  });

  it('reports a route that was removed before reversing it', async () => {
    await expect(reverseRoute('missing')).rejects.toThrow('Cette trace n’est plus sur cet appareil.');
  });
});
