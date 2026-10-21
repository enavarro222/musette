import type { MusettePlatform } from './platform.types';
import { FileSystemAccessTransport } from './transport/fileSystemAccess';
import { pickBle, WebGattTransport } from './transport/webBluetooth';

/** Web: what the browser offers (Chrome and Edge have both, Safari neither). */
export const platform: MusettePlatform = {
  name: 'web',
  transports: {
    gatt: WebGattTransport.isSupported() ? (peer) => new WebGattTransport(peer) : undefined,
    blePick: WebGattTransport.isSupported() ? pickBle : undefined,
    usbFiles: FileSystemAccessTransport.isSupported() ? () => new FileSystemAccessTransport() : undefined,
  },
  unsupported: 'Non pris en charge par ce navigateur (essayez Chrome ou Edge sur ordinateur).',
};
