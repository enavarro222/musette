import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeCc600 } from '../test/fakeCc600';
import { ATLAS_ZONES, DEFAULT_ATLAS, isRegionalAtlas, prepareAtlas, sendAtlas } from './atlas';
import { loadCore } from './core';
import { BleDevice } from './devices/bleDevice';
import { CC600 } from './devices/cc600';

const source = new Uint8Array(readFileSync(new URL('../../assets/atlas/europe.ocat', import.meta.url)));

async function connected(free = 1 << 20) {
  const fake = new FakeCc600({ free });
  const device = new BleDevice(CC600, fake, { requestMs: 300, shortMs: 50 });
  await device.connect();
  return { device, fake };
}

describe('permanent global atlas', () => {
  it('bundles a real Europe atlas under 512 KiB and selects a smaller France atlas', async () => {
    const europe = await prepareAtlas(source, { ...DEFAULT_ATLAS, zone: 'europe' });
    const france = await prepareAtlas(source, DEFAULT_ATLAS);
    expect(new TextDecoder().decode(europe.slice(0, 4))).toBe('OCAT');
    expect(europe.length).toBeGreaterThan(100_000);
    expect(europe.length).toBeLessThanOrEqual(512 * 1024);
    expect(france.length).toBeGreaterThan(10_000);
    expect(france.length).toBeLessThan(europe.length / 2);
    const outline = await prepareAtlas(source, { ...DEFAULT_ATLAS, rivers: false, cities: false });
    expect(outline.length).toBeLessThan(france.length);
  });

  it('provides richer local packs for all 13 regions without exceeding the device budget', async () => {
    const regions = (Object.keys(ATLAS_ZONES) as (keyof typeof ATLAS_ZONES)[]).filter(isRegionalAtlas);
    expect(regions).toHaveLength(13);
    for (const zone of regions) {
      const local = new Uint8Array(readFileSync(new URL(`../../assets/atlas/${zone}.ocat`, import.meta.url)));
      const options = { ...DEFAULT_ATLAS, zone };
      const enriched = await prepareAtlas(local, options);
      const coarse = await prepareAtlas(source, options);
      expect(enriched.length, zone).toBeGreaterThan(coarse.length * 1.5);
      expect(enriched.length, zone).toBeLessThanOrEqual(512 * 1024);
    }
  });

  it('installs an enriched regional pack through the firmware format validator', async () => {
    const { device, fake } = await connected();
    const local = new Uint8Array(readFileSync(new URL('../../assets/atlas/occitanie.ocat', import.meta.url)));
    const bytes = await prepareAtlas(local, { ...DEFAULT_ATLAS, zone: 'occitanie' });
    await sendAtlas(device, bytes, () => {});
    expect(device.atlasBytes).toBe(bytes.length);
    expect(fake.device.committed()).toEqual(bytes);
    expect(fake.device.chunkBytes()).toBe(bytes.length);
  });

  it('installs without an active route and keeps the atlas when a different route is sent', async () => {
    const { device, fake } = await connected();
    const bytes = await prepareAtlas(source, DEFAULT_ATLAS);
    const progress: number[] = [];
    await sendAtlas(device, bytes, (r) => progress.push(r));
    expect(fake.device.committed()).toEqual(bytes);
    expect(fake.device.chunkBytes()).toBe(bytes.length);
    expect(progress.at(-1)).toBe(1);
    expect(device.atlasBytes).toBe(bytes.length);

    await device.uploadRoute({ name: 'Autre trace', lats: [45, 45.01], lons: [5, 5.01], eles: [200, 250] });
    await device.refreshInfo();
    expect(device.atlasBytes).toBe(bytes.length);
    expect(new TextDecoder().decode(fake.device.committed()!.slice(0, 4))).toBe('OCRT');
  });

  it('rejects a damaged replacement and keeps the installed atlas', async () => {
    const { device } = await connected();
    const bytes = await prepareAtlas(source, DEFAULT_ATLAS);
    await sendAtlas(device, bytes, () => {});
    const bad = bytes.slice();
    bad[bad.length - 1] ^= 1;
    await expect(device.uploadFile('atlas', bad)).rejects.toThrow();
    await device.refreshInfo();
    expect(device.atlasBytes).toBe(bytes.length);
  });

  it('checks the device room before sending a single file byte', async () => {
    const { device, fake } = await connected(1024);
    const bytes = await prepareAtlas(source, DEFAULT_ATLAS);
    await expect(sendAtlas(device, bytes, () => {})).rejects.toThrow('Pas assez de place');
    expect(fake.device.chunkBytes()).toBe(0);
  });

  it('explains that older firmware cannot receive an atlas', async () => {
    const { device, fake } = await connected();
    Object.defineProperty(device, 'fileLimits', { get: () => ({ route: 65536, map: 524288 }) });
    await expect(sendAtlas(device, source, () => {})).rejects.toThrow('Mettez à jour le firmware');
    expect(fake.device.chunkBytes()).toBe(0);
  });

  it('validates the source and geographic bounds in the shared core', async () => {
    const core = await loadCore();
    expect(() => core.cc600Atlas(source, 'Erreur', [10, 45, 5, 46], true, true)).toThrow();
    expect(() => core.cc600Atlas(new Uint8Array([1, 2]), 'France', [-5, 41, 10, 52], true, true)).toThrow();
  });
});
