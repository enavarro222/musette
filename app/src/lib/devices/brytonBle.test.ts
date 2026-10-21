import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fitFile } from '../../test/fakeCc600';
import { FakeBryton, type FakeBrytonOptions } from '../../test/fakeBryton';
import { loadCore } from '../core';
import { BleDevice } from './bleDevice';
import { BRYTON, rideStart } from './brytonBle';

const FAST = { requestMs: 500, shortMs: 300 };

async function connected(options: FakeBrytonOptions = {}) {
  const fake = new FakeBryton(options);
  const device = new BleDevice(BRYTON, fake, FAST);
  await device.connect();
  return { fake, device };
}

/** The 16 name bytes of a bike-name answer chunk. */
function bikeName(slot: number, name: string): number[] {
  const b = [...new TextEncoder().encode(name)];
  return [1, 5, slot, ...b, ...new Array(16 - b.length).fill(0)];
}

describe('Bryton over Bluetooth', () => {
  it('connects as the app does: device info, then "new app" for the handshake', async () => {
    const { fake, device } = await connected();
    expect(device.name).toBe('Rider750');
    expect(device.capabilities).toMatchObject({ settings: true, uploadRoute: true });
    expect(fake.sent('command').slice(0, 2)).toEqual([
      [6, 0x04], // read device info
      [6, 0x44, 3], // action 3: the device sends the data only then
    ]);
    expect(fake.sent('setting')[0]).toEqual([0x2f, 1, 0, 0x30]);
  });

  it('lists, downloads and acknowledges a ride, with the same id as over USB', async () => {
    const fit = fitFile(Uint8Array.from({ length: 50_000 }, (_, i) => (i * 7) & 0xff));
    const { fake, device } = await connected({ rides: [{ id: '260922125127', fit }] });
    const [ride] = await device.listActivities();
    expect(ride).toMatchObject({ id: '260922125127', synced: false });
    expect(ride.startTime).toBe(rideStart('260922125127'));

    const progress: number[] = [];
    const bytes = await device.downloadActivity(ride, (r) => progress.push(r));
    expect(bytes).toEqual(fit);
    expect(progress.at(-1)).toBe(1);
    // Size first, then ranges of 39 600 bytes.
    const ranges = fake.sent('command').filter((c) => c[0] === 17 && c[1] >> 5 === 0);
    expect(ranges.map((c) => new DataView(Uint8Array.from(c).buffer).getUint32(11))).toEqual([4, 39_600, fit.length - 39_600]);

    await device.acknowledgeActivity(ride);
    const ack = fake.sent('setting').find((s) => s[0] === 51)!;
    const id = Date.UTC(2026, 8, 22, 12, 51, 27) / 1000;
    expect(ack.slice(0, 6)).toEqual([51, 1, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, id >>> 24]);
    expect(fake.rides).toEqual([]);
    expect(await device.listActivities()).toEqual([]);
  });

  it('refuses a corrupted ride', async () => {
    const fit = fitFile(new Uint8Array(3000));
    fit[100] ^= 0xff;
    const { device } = await connected({ rides: [{ id: '260922125127', fit }] });
    await expect(device.downloadActivity({ id: '260922125127' })).rejects.toThrow();
  });

  it('sends a route compressed, then its name in chunks', async () => {
    const { fake, device } = await connected();
    const lats = Array.from({ length: 200 }, (_, i) => 43.6 + Math.sin(i / 10) * 0.01);
    const lons = Array.from({ length: 200 }, (_, i) => 1.44 + i * 1e-4);
    const progress: number[] = [];
    await device.uploadRoute({ name: 'Tour du Tarn à vélo', lats, lons, eles: lats.map(() => NaN) }, (r) => progress.push(r));
    // 21 bytes of UTF-8: header [0, chunks + 1, length], then chunks of 16 bytes.
    const name = new TextEncoder().encode('Tour du Tarn à vélo');
    expect(fake.sent('setting').filter((s) => s[0] === 49 && s.length > 2).map((s) => s.slice(2, 5))).toEqual([
      [0, 3, 21],
      [1, ...name.subarray(0, 2)],
      [2, ...name.subarray(16, 18)],
    ]);
    const received = fake.routes.get('Tour du Tarn à vélo')!;
    expect([...received.subarray(0, 2)]).toEqual([0x1f, 0x8b]); // gzip, as the Rider 750 wants
    const route = gunzipSync(received);
    expect(new TextDecoder().decode(route.subarray(8, 12))).toBe('.FIT');
    expect(progress.at(-1)).toBe(1);
  });

  it('reads settings with their labels and bike names, and writes one', async () => {
    const { fake, device } = await connected({
      settings: {
        '20:': [6],
        '25:': [0],
        '27:0': [0, 1],
        '27:1': [1, 0],
        '31:1,5,0': bikeName(0, 'Route'),
        '31:1,5,1': bikeName(1, 'VTT'),
        '40:1': [1, 1],
      },
    });
    const s = await device.readSettings();
    expect(s.values).toMatchObject({ backlight: '6', key_tone: false, 'bike0.auto_pause': true, 'bike1.gps': '1' });
    const label = (k: string) => s.fields.find((f) => f.key === k)?.label;
    expect(label('bike1.auto_pause')).toBe('VTT · Pause intelligente');
    expect(label('bike2.auto_pause')).toBeUndefined(); // no third bike
    expect(s.fields.find((f) => f.key === 'backlight')).toMatchObject({ type: 'choice', readOnly: false });

    await device.writeSettings({ key_tone: true, 'bike1.auto_pause': true });
    expect(fake.settings['25:']).toEqual([1]);
    expect(fake.settings['27:1']).toEqual([1, 1]);
    expect(fake.sent('setting').filter((f) => f[1] === 1 && (f[0] === 25 || f[0] === 27))).toEqual([
      [25, 1, 1, 27],
      [27, 1, 1, 1, 30],
    ]);
  });

  it('checks every change before sending any', async () => {
    const { fake, device } = await connected();
    const before = fake.written.length;
    await expect(device.writeSettings({ key_tone: true, 'zone.ftp': 250 })).rejects.toThrow();
    expect(fake.written.length).toBe(before);
  });

  it('reports a refused setting', async () => {
    const { device } = await connected({ refuseSet: 26 });
    await expect(device.writeSettings({ sound: false })).rejects.toThrow(/refusé/);
  });

  it('fails when the device stops answering', async () => {
    const { fake, device } = await connected({ rides: [{ id: '260922125127', fit: fitFile(new Uint8Array(10)) }] });
    fake.write = async () => undefined; // the link is gone
    await expect(device.listActivities()).rejects.toThrow(/ne répond pas/);
    expect((await loadCore()).settingFields('bryton-rider-750').length).toBeGreaterThan(10);
  });
});
