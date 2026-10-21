import { describe, expect, it } from 'vitest';
import { loadCore } from '../core';
import { allServices } from '../transport/types';
import { BLE_MODELS } from './registry';

describe('Bluetooth models', () => {
  it('search for the services their Rust session uses', async () => {
    const core = await loadCore();
    for (const m of BLE_MODELS) {
      const session = core.session(m.id);
      const services = new Set(session.channels().map((c) => c.service));
      session.free();
      expect(allServices(m.ble!.options), m.id).toEqual(expect.arrayContaining([...services]));
    }
  });
});
