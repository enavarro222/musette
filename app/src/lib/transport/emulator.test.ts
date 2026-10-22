import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmulatorGattTransport, emulatorOrigin, pickEmulator } from './emulator';
import type { BleOptions } from './types';

const PAGE = 'https://enavarro222.github.io';
const CC600: BleOptions = { serviceUuid: '18fbbd9a-adda-4ef4-9635-befd2efbf8a3', namePrefix: 'OpenCC' };

/** A window framed by a page that answers every request (`answer`) and records them. */
function framed(search: string, answer: (m: any) => Record<string, unknown>) {
  const win = new EventTarget() as any;
  const sent: any[] = [];
  const deliver = (data: unknown, origin = PAGE, source = win.parent) =>
    win.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }));
  win.location = { search };
  win.parent = {
    postMessage: (m: any, origin: string) => {
      sent.push({ ...m, origin });
      queueMicrotask(() => deliver({ gatt: 'reply', id: m.id, ...answer(m) }));
    },
  };
  vi.stubGlobal('window', win);
  return { sent, deliver };
}

afterEach(() => vi.unstubAllGlobals());

describe('emulator transport', () => {
  it('is on only when framed with an emulator origin', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { search: `?emulator=${PAGE}` } }));
    (window as any).parent = window;
    expect(emulatorOrigin()).toBeUndefined();
    framed('', () => ({ ok: true }));
    expect(emulatorOrigin()).toBeUndefined();
    framed(`?emulator=${encodeURIComponent(PAGE + '/opencc600/demo/')}`, () => ({ ok: true }));
    expect(emulatorOrigin()).toBe(PAGE);
  });

  it('picks the page device, writes, subscribes and hears notifications from that origin only', async () => {
    const { sent, deliver } = framed(`?emulator=${PAGE}`, (m) =>
      m.gatt === 'hello' ? { ok: true, name: 'CC600 OpenCC600', serviceUuid: CC600.serviceUuid.toUpperCase() } : { ok: true },
    );
    const peer = await pickEmulator(PAGE, [{ serviceUuid: '0000', namePrefix: 'Rider' }, CC600]);
    expect(peer.options).toBe(CC600);
    const t = new EmulatorGattTransport(peer, PAGE);
    await t.connect();
    expect(t.peerName).toBe('CC600 OpenCC600');
    await t.subscribe(CC600.serviceUuid, 'tx');
    await t.write(CC600.serviceUuid, 'rx', Uint8Array.of(1, 2), false);
    expect(sent.map((m) => m.gatt)).toEqual(['hello', 'connect', 'subscribe', 'write']);
    expect(sent[3]).toMatchObject({ characteristic: 'rx', bytes: [1, 2], withResponse: false, origin: PAGE });

    const heard: [string, number[]][] = [];
    const stop = t.onNotify((c, b) => heard.push([c, Array.from(b)]));
    deliver({ gatt: 'notify', characteristic: 'TX', bytes: [7] });
    deliver({ gatt: 'notify', characteristic: 'tx', bytes: [8] }, 'https://elsewhere.example');
    stop();
    deliver({ gatt: 'notify', characteristic: 'tx', bytes: [9] });
    expect(heard).toEqual([['tx', [7]]]);
  });

  it('turns a refused request into an error', async () => {
    framed(`?emulator=${PAGE}`, () => ({ ok: false, error: 'pas de compteur' }));
    await expect(pickEmulator(PAGE, [CC600])).rejects.toThrow('pas de compteur');
  });
});
