import type { DeviceField, DeviceSetting } from '../core';
import type { DeviceSettings } from '../settings';
import type { BleOptions } from '../transport/types';
import type { BleModel } from './bleDevice';
import { toField, toValue, CC600_SETTINGS } from './cc600Settings';

/** How a search finds a CC600 (its channels come from Rust: a test checks they match). */
export const CC600_BLE: BleOptions = {
  serviceUuid: '18fbbd9a-adda-4ef4-9635-befd2efbf8a3',
  namePrefix: 'CC600',
};

function presentSettings(fields: DeviceField[], values: DeviceSetting[]): DeviceSettings {
  const byKey = new Map(values.map((v) => [v.key, v]));
  const shown = fields.filter((f) => byKey.has(f.key));
  return {
    fields: shown.map((f) => toField(f, byKey.get(f.key)!.text)),
    values: Object.fromEntries(shown.map((f) => [f.key, toValue(f, byKey.get(f.key)!)])),
  };
}

/** GEOID CC600 with the OpenCC600 firmware: the protocol is `driver-cc600`. */
export const CC600: BleModel = {
  id: 'open-cc600',
  name: 'CC600',
  presentSettings,
  settingLabel: (key) => CC600_SETTINGS[key]?.label ?? key,
};
