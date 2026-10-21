import type { BleOptions } from '../transport/types';
import type { BleModel } from './bleDevice';
import { presentSettings, settingLabel } from './brytonSettings';

/**
 * How a search finds a Rider computer with Bryton's firmware: a Rider 750
 * advertises `0x2014` and its name ("Rider750"); the protocol is in the
 * other services (its channels come from Rust: a test checks they match).
 */
export const BRYTON_BLE: BleOptions = {
  serviceUuid: '00002014-0000-1000-8000-00805f9b34fb',
  namePrefix: 'Rider',
  services: ['454d7788-a122-058d-9b42-9d0f3772af82', '50b85566-c2de-a994-094d-340090726877'],
};

/**
 * Bryton Rider 750 over Bluetooth, stock firmware: the protocol is
 * `driver_bryton::ble`. See docs/drivers/bryton-ble.md.
 */
export const BRYTON: BleModel = {
  id: 'bryton-rider-750',
  name: 'Bryton',
  presentSettings,
  settingLabel,
};

/** Unix seconds of a ride id (`yyMMddHHmmss`, the device's local time). */
export function rideStart(id: string): number | undefined {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(id);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(2000 + y, mo - 1, d, h, mi, s).getTime() / 1000;
}
