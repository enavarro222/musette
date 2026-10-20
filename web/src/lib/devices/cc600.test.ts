import { describe, expect, it } from 'vitest';
import { FakeCc600, fitFile } from '../../test/fakeCc600';
import { Cc600Device } from './cc600';

const FAST = { requestMs: 300, stallMs: 50 };

function file(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 8)) & 0xff);
}

async function connected(fake: FakeCc600) {
  const device = new Cc600Device(fake, FAST);
  await device.connect();
  return device;
}

describe('CC600 file upload', () => {
  it('sends the whole file and reports progress up to 1', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    const data = file(20_000);
    const progress: number[] = [];
    await device.uploadFile('route', data, (r) => progress.push(r));
    expect(fake.receiver.committed()).toEqual(data);
    expect(fake.chunkBytes).toBe(data.length);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('resends lost chunks', async () => {
    const lost = new Set([2, 3, 30, 31, 32, 60]);
    const fake = new FakeCc600({ dropChunk: (n) => lost.has(n) });
    const device = await connected(fake);
    const data = file(20_000);
    await device.uploadFile('map', data);
    expect(fake.receiver.committed()).toEqual(data);
  });

  it('asks the device where it is when an ack is lost', async () => {
    const fake = new FakeCc600({ dropAck: (n) => n === 3 });
    const device = await connected(fake);
    const data = file(20_000);
    await device.uploadFile('map', data);
    expect(fake.receiver.committed()).toEqual(data);
  });

  it('resumes after the link dropped instead of starting over', async () => {
    const data = file(20_000);
    const fake = new FakeCc600();
    const device = await connected(fake);
    let cut = false;
    const first = device.uploadFile('route', data, (r) => {
      if (r > 0.5 && !cut) {
        cut = true;
        fake.cut();
      }
    });
    await expect(first).rejects.toThrow();
    const kept = fake.receiver.received();
    expect(kept).toBeGreaterThan(data.length / 2);
    expect(kept).toBeLessThan(data.length);

    await fake.connect();
    const sentBefore = fake.chunkBytes;
    await device.uploadFile('route', data);
    expect(fake.receiver.committed()).toEqual(data);
    expect(fake.chunkBytes - sentBefore).toBe(data.length - kept);
  });

  it('says in plain words that the device is full', async () => {
    const device = await connected(new FakeCc600({ free: 1000 }));
    await expect(device.uploadFile('map', file(5000))).rejects.toThrow('Pas assez de place sur le compteur');
  });

  it('starts over when the device holds another file', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    let cut = false;
    await expect(
      device.uploadFile('route', file(10_000), (r) => {
        if (r > 0.3 && !cut) {
          cut = true;
          fake.cut();
        }
      }),
    ).rejects.toThrow();
    await fake.connect();
    const other = file(12_000).reverse();
    await device.uploadFile('route', other);
    expect(fake.receiver.committed()).toEqual(other);
  });
});

describe('CC600 route', () => {
  it('sends the route as an OCRT file', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    // 2 km north, a point every 10 m
    const n = 201;
    const route = {
      name: 'Col du test',
      lats: Array.from({ length: n }, (_, i) => 45 + (i * 0.01) / 111.32),
      lons: Array.from({ length: n }, () => 3),
      eles: Array.from({ length: n }, (_, i) => 200 + i / 2),
    };
    const progress: number[] = [];
    await device.uploadRoute(route, (r) => progress.push(r));
    const file = fake.receiver.committed()!;
    expect(new TextDecoder().decode(file.subarray(0, 4))).toBe('OCRT');
    expect(new TextDecoder().decode(file)).toContain('Col du test');
    expect(progress.at(-1)).toBe(1);
  });
});

describe('CC600 activities', () => {
  it('lists and downloads a ride in several reads', async () => {
    const fit = fitFile(file(3000));
    const fake = new FakeCc600({ activities: [{ id: 7, startTime: 1_790_000_000, fit }] });
    const device = await connected(fake);
    const [ref] = await device.listActivities();
    expect(ref).toEqual({ id: '7', startTime: 1_790_000_000, size: fit.length, synced: false });
    expect(await device.downloadActivity(ref)).toEqual(fit);
  });

  it('refuses a corrupted ride', async () => {
    const fit = fitFile(file(3000));
    fit[100] ^= 0xff;
    const device = await connected(new FakeCc600({ activities: [{ id: 1, startTime: 1_790_000_000, fit }] }));
    const [ref] = await device.listActivities();
    await expect(device.downloadActivity(ref)).rejects.toThrow();
  });
});
