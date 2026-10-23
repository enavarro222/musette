import { describe, expect, it, vi } from 'vitest';
import type { ParsedRoute } from './core';

vi.mock('./storage', () => ({ prefs: { get: async () => undefined, set: async () => undefined } }));

const { loadCore } = await import('./core');
const { BleDevice } = await import('./devices/bleDevice');
const { CC600 } = await import('./devices/cc600');
const { FakeCc600 } = await import('../test/fakeCc600');
const { DEFAULT_OPTIONS, planMap } = await import('./mapPlan');
const { sendRouteAndMap } = await import('./mapSend');

const n = 301;
const route: ParsedRoute = {
  name: 'Nord',
  lats: Array.from({ length: n }, (_, i) => 45 + (i * 10) / 111_320),
  lons: Array(n).fill(3),
  eles: Array(n).fill(200),
};
const road = { cls: 'minor' as const, lats: [45, 45.03], lons: [3.001, 3.001] };
/** Left out of a lighter map. */
const path = { cls: 'path' as const, lats: [45, 45.01, 45.02], lons: [2.999, 2.9985, 2.999] };

async function setup(free: number) {
  const fake = new FakeCc600({ free });
  const device = new BleDevice(CC600, fake, { requestMs: 300, shortMs: 50 });
  await device.connect();
  const limit = device.fileLimits!.map;
  const core = await loadCore();
  const refit = (l: number) => planMap(core, route, [road, path], DEFAULT_OPTIONS, l);
  return { fake, device, map: { status: 'ready' as const, plan: refit(limit), limit, refit } };
}

describe('sending a route with its map', () => {
  it('sends the route, then the map made for it, each once', async () => {
    const { fake, device, map } = await setup(1 << 20);
    const steps: string[] = [];
    let routeFile: Uint8Array | undefined;
    await sendRouteAndMap(device, route, map, (s) => {
      if (s.what === 'map' && !routeFile) routeFile = fake.device.committed();
      steps.push(s.what);
    });
    expect(new TextDecoder().decode(routeFile!.slice(0, 4))).toBe('OCRT');
    expect(fake.device.committed()).toEqual(map.plan.bytes);
    expect(fake.device.chunkBytes()).toBe(routeFile!.length + map.plan.bytes.length);
    expect(steps.indexOf('map')).toBeGreaterThan(steps.lastIndexOf('route'));
  });

  it('makes the map lighter when the new route took its room', async () => {
    const { fake, device, map } = await setup(1 << 20);
    const full = map.plan.bytes.length;
    // the device answers less room once the route is there
    let routeSent = false;
    const refreshInfo = device.refreshInfo.bind(device);
    Object.defineProperty(device, 'fileLimits', {
      get: () => ({ route: 1 << 20, map: routeSent ? full - 1 : 1 << 20 }),
    });
    device.refreshInfo = async () => {
      routeSent = !!fake.device.committed();
      await refreshInfo();
    };
    const sent = await sendRouteAndMap(device, route, map, () => undefined);
    expect(sent).not.toBe(map.plan);
    expect(sent!.bytes.length).toBeLessThan(full);
    expect(fake.device.committed()).toEqual(sent!.bytes);
  });

  it('sends the route alone when the map does not fit', async () => {
    const { fake, device, map } = await setup(1 << 20);
    const tooBig = { ...map, plan: { ...map.plan, fits: false } };
    await sendRouteAndMap(device, route, tooBig, () => undefined);
    const routeFile = fake.device.committed()!;
    expect(new TextDecoder().decode(routeFile.slice(0, 4))).toBe('OCRT');
    expect(fake.device.chunkBytes()).toBe(routeFile.length);
  });
});
