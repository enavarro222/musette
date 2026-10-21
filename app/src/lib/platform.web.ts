import type { MusettePlatform } from './platform.types';
import { FileSystemAccessTransport } from './transport/fileSystemAccess';
import { pickBle, WebBluetoothTransport } from './transport/webBluetooth';

/** Web: what the browser offers (Chrome and Edge have both, Safari neither). */
export const platform: MusettePlatform = {
  name: 'web',
  transports: {
    ble: WebBluetoothTransport.isSupported() ? (peer) => new WebBluetoothTransport(peer) : undefined,
    blePick: WebBluetoothTransport.isSupported() ? pickBle : undefined,
    usbFiles: FileSystemAccessTransport.isSupported() ? () => new FileSystemAccessTransport() : undefined,
  },
  unsupported: 'Non pris en charge par ce navigateur (essayez Chrome ou Edge sur ordinateur).',
};
