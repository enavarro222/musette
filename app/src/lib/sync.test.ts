import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredActivity } from './storage';

const stored = new Map<string, StoredActivity>();
const events: string[] = [];

vi.mock('./storage', () => ({
  activities: {
    has: async (key: string) => stored.has(key),
    put: async (a: StoredActivity) => {
      events.push(`store ${a.key}`);
      stored.set(a.key, a);
    },
  },
}));

const { syncActivities } = await import('./sync');
const { FakeCc600, fitFile } = await import('../test/fakeCc600');
const { BleDevice } = await import('./devices/bleDevice');
const { CC600 } = await import('./devices/cc600');

const ride = (id: number) => ({ id, startTime: 1_790_000_000 + id * 3600, fit: fitFile(Uint8Array.of(id, 1, 2, 3)) });

describe('ride sync', () => {
  beforeEach(() => {
    stored.clear();
    events.length = 0;
  });

  it('acknowledges a ride only after it is stored', async () => {
    const fake = new FakeCc600({ activities: [ride(1), ride(2)] });
    const device = new BleDevice(CC600, fake);
    const ack = device.acknowledgeActivity.bind(device);
    device.acknowledgeActivity = async (ref, fit) => {
      events.push(`ack open-cc600:${ref.id}`);
      return ack(ref, fit);
    };
    await device.connect();
    expect(await syncActivities(device, () => {})).toBe(2);
    expect(events).toEqual(['store open-cc600:1', 'ack open-cc600:1', 'store open-cc600:2', 'ack open-cc600:2']);
    expect(fake.device.acked()).toEqual([1, 2]);
  });

  it('neither stores nor acknowledges a corrupted ride', async () => {
    const bad = ride(1);
    bad.fit[5] ^= 0xff;
    const fake = new FakeCc600({ activities: [bad] });
    const device = new BleDevice(CC600, fake);
    await device.connect();
    await expect(syncActivities(device, () => {})).rejects.toThrow();
    expect(stored.size).toBe(0);
    expect(fake.device.acked()).toEqual([]);
  });

  it('skips rides already copied', async () => {
    const fake = new FakeCc600({ activities: [ride(1), ride(2)] });
    const device = new BleDevice(CC600, fake);
    await device.connect();
    await syncActivities(device, () => {});
    events.length = 0;
    expect(await syncActivities(device, () => {})).toBe(0);
    expect(events).toEqual([]);
  });
});
