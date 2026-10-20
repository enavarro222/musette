import { FileSystemAccessTransport } from './transport/fileSystemAccess';
import type { TransportFactories } from './transport/types';
import { WebBluetoothTransport } from './transport/webBluetooth';

/**
 * What the host environment provides. The browser build uses `webPlatform`;
 * other hosts (e.g. a native shell) can pass their own transports.
 */
export interface MusettePlatform {
  name: string;
  transports: TransportFactories;
}

export const webPlatform: MusettePlatform = {
  name: 'web',
  transports: {
    ble: WebBluetoothTransport.isSupported() ? (o) => new WebBluetoothTransport(o) : undefined,
    usbFiles: FileSystemAccessTransport.isSupported() ? () => new FileSystemAccessTransport() : undefined,
  },
};
