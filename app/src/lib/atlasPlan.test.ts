import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ATLAS, atlasSelection, readAtlasOptions, sendAtlas, type AtlasOptions } from './atlas';
import { fitAtlas, prepareGlobalAtlas } from './atlasPlan';
import { loadCore, type AtlasFeatures, type Core } from './core';
import type { AtlasOsmData } from './atlasOsm';
import { FakeCc600 } from '../test/fakeCc600';
import { BleDevice } from './devices/bleDevice';
import { CC600 } from './devices/cc600';

const base = new Uint8Array(readFileSync(new URL('../../assets/atlas/europe.ocat', import.meta.url)));
const options: AtlasOptions = { ...DEFAULT_ATLAS, zone: 'custom', bounds: [1.9, 43, 2.1, 43.2], source: 'osm' };
const data: AtlasOsmData = { zoom: 14, tiles: 10, features: [
  { cls: 'minor', label: '', lats: [43.01, 43.19], lons: [1.91, 2.09] },
  { cls: 'path', label: '', lats: [43.011, 43.191], lons: [1.91, 2.09] },
  { cls: 'stream', label: '', lats: [43.1, 43.1], lons: [1.9, 2.1] },
  { cls: 'city', label: 'Village', lats: [43.1], lons: [2] },
] };

describe('automatic permanent atlas budget', () => {
  it('prepares and sends a precise geographic atlas without an active route', async () => {
    const core = await loadCore();
    const plan = await fitAtlas(core, base, data, options, 512 * 1024);
    expect(plan.bytes[4]).toBe(2);
    expect(plan.reduced).toBe(false);
    const fake = new FakeCc600({ free: 1 << 20 });
    const device = new BleDevice(CC600, fake, { requestMs: 300, shortMs: 50 });
    await device.connect();
    await sendAtlas(device, plan.bytes, () => {}, 2);
    expect(fake.device.committed()).toEqual(plan.bytes);
    expect(fake.device.chunkBytes()).toBe(plan.bytes.length);
  });

  it('explains an old firmware format before sending any precise atlas bytes', async () => {
    const core = await loadCore();
    const plan = await fitAtlas(core, base, data, options, 512 * 1024);
    const fake = new FakeCc600({ free: 1 << 20 });
    const device = new BleDevice(CC600, fake, { requestMs: 300, shortMs: 50 });
    await device.connect();
    Object.defineProperty(device, 'atlasVersion', { get: () => 1 });
    await expect(sendAtlas(device, plan.bytes, () => {}, 2)).rejects.toThrow('Mettez à jour le firmware');
    expect(fake.device.chunkBytes()).toBe(0);
  });

  it('reduces local detail to fit the actual free budget while keeping the selected bounds', async () => {
    const core = await loadCore();
    const dense: AtlasOsmData = { ...data, features: Array.from({ length: 800 }, (_, k) => ({
      cls: 'minor', label: '',
      lats: Array.from({ length: 50 }, (_, i) => 43.02 + i * 0.003 + (i % 2 ? 0.001 : 0)),
      lons: Array.from({ length: 50 }, (_, i) => 1.92 + k * 0.0001 + (i % 2 ? 0.01 : 0)),
    })) };
    const rich = await fitAtlas(core, base, dense, options, 512 * 1024);
    const small = await fitAtlas(core, base, dense, options, 4000);
    expect(small.reduced).toBe(true);
    expect(small.bytes.length).toBeLessThanOrEqual(4000);
    expect(rich.bytes.length).toBeGreaterThan(small.bytes.length);
    expect(atlasSelection(options).bounds).toEqual([1.9, 43, 2.1, 43.2]);
    await expect(fitAtlas(core, base, data, options, 1)).rejects.toThrow('ne tient pas');
  });

  it('retains included data as an explicit preparation choice and validates old preferences', async () => {
    const old = { zone: 'occitanie', rivers: false, cities: true };
    expect(readAtlasOptions(old).source).toBe('osm');
    expect(readAtlasOptions({ ...old, zone: 'custom', bounds: [2, 3, 1, 4] })).toEqual(DEFAULT_ATLAS);
    const plan = await prepareGlobalAtlas(base, { ...DEFAULT_ATLAS, source: 'included' });
    expect(plan.source).toBe('included');
    expect(plan.bytes[4]).toBe(1);
  });

  it('keeps main axes and fills spare bytes with secondary roads before local streets', async () => {
    const core = await loadCore();
    const compiled: { input: AtlasFeatures; bytes?: Uint8Array }[] = [];
    const observed: Core = { ...core, cc600BuildAtlas: (...args) => {
      const bytes = core.cc600BuildAtlas(...args);
      compiled.push({ input: args[3], bytes }); return bytes;
    } };
    const network: AtlasOsmData = { ...data, features: [
      ...Array.from({ length: 200 }, (_, i) => ({ cls: 'minor' as const, roadRank: 5, label: '', lats: [43.04, 43.18], lons: [1.91 + i * 0.0002, 2.05] })),
      ...Array.from({ length: 50 }, (_, i) => ({ cls: 'minor' as const, roadRank: 4, label: '', lats: [43.08, 43.18], lons: [1.92 + i * 0.0002, 2.08] })),
      ...Array.from({ length: 50 }, (_, i) => ({ cls: 'minor' as const, roadRank: 3, label: '', lats: [43.06, 43.18], lons: [1.94 + i * 0.0002, 2.05] })),
      { cls: 'road', roadRank: 2, label: '', lats: [43.02, 43.18], lons: [1.93, 2.05] },
    ] };
    const budget = 1000;
    const plan = await fitAtlas(observed, base, network, options, budget);
    const chosen = compiled.find((c) => c.bytes === plan.bytes)!.input;
    expect(chosen.classes.filter((c) => c === 'road')).toHaveLength(1);
    const secondary = chosen.classes.filter((c) => c === 'minor').length;
    expect(secondary).toBeGreaterThan(0);
    expect(secondary).toBeLessThan(50);
    // More-important secondary ways survive even though tertiary/local ways came first in the source.
    expect(chosen.lats.filter((_, i) => i > 1 && i % 2 === 0).every((lat) => lat === 43.06)).toBe(true);
    expect(plan.bytes.length).toBeLessThanOrEqual(budget);
    expect(plan.bytes.length).toBeGreaterThan(budget - 80);
    expect(plan.detail).toContain('Grands axes');
    expect(plan.detail).toContain('Routes secondaires');
    expect(plan.detail).not.toContain('Rues et dessertes');
    const decoded = core.cc600AtlasPreview(plan.bytes);
    expect(decoded.levels[0].classes.filter((c) => c === 'road')).toHaveLength(1);
    expect(decoded.levels[0].classes.filter((c) => c === 'minor')).toHaveLength(secondary);
    const fake = new FakeCc600({ free: 1 << 20 });
    const device = new BleDevice(CC600, fake, { requestMs: 300, shortMs: 50 });
    await device.connect(); await sendAtlas(device, plan.bytes, () => {}, 2);
    expect(fake.device.committed()).toEqual(plan.bytes);
    const rich = await fitAtlas(core, base, network, options, 512 * 1024);
    expect(rich.detail).toContain('Rues et dessertes');
    expect(rich.bytes.length).toBeGreaterThan(plan.bytes.length);
  });
});
