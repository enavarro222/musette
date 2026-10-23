import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGattTransport } from './webBluetooth';

/** A device whose characteristic takes writes of at most `mtu` - 3 bytes, as a browser does. */
function device(mtu: number, connected = true) {
  const writes: number[][] = [];
  const characteristic = {
    async writeValueWithoutResponse(v: Uint8Array) {
      if (v.length > mtu - 3) throw new DOMException('Value too long', 'NotSupportedError');
      writes.push(Array.from(v));
    },
  };
  const server = { connected, getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) };
  const handle = { gatt: { connect: async () => server } };
  return { writes, peer: { id: 'd', name: 'OpenCC600', options: { serviceUuid: 's', namePrefix: 'OpenCC' }, handle } };
}

describe('Web Bluetooth transport', () => {
  beforeEach(() => vi.stubGlobal('navigator', { bluetooth: {} }));
  afterEach(() => vi.unstubAllGlobals());

  it('writes 244 bytes at once where the link takes them', async () => {
    const { writes, peer } = device(247);
    const t = new WebGattTransport(peer);
    await t.connect();
    await t.write('s', 'rx', new Uint8Array(244), false);
    expect(writes.map((w) => w.length)).toEqual([244]);
    expect(t.maxWrite).toBe(244);
  });

  it('falls back to 20 bytes for good at the first write refused, sending it all', async () => {
    const { writes, peer } = device(23);
    const t = new WebGattTransport(peer);
    await t.connect();
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => i);
    await t.write('s', 'rx', bytes, false);
    expect(writes.map((w) => w.length)).toEqual([20, 20, 10]);
    expect(writes.flat()).toEqual(Array.from(bytes));
    expect(t.maxWrite).toBe(20);
  });

  it('keeps 244 bytes when the write failed because the link was lost', async () => {
    const { peer } = device(23, false);
    const t = new WebGattTransport(peer);
    await t.connect();
    await expect(t.write('s', 'rx', new Uint8Array(50), false)).rejects.toThrow();
    expect(t.maxWrite).toBe(244);
  });
});
