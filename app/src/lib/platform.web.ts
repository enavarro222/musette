import type { MusettePlatform } from './platform.types';
import { emulatorOrigin, EmulatorGattTransport, pickEmulator } from './transport/emulator';
import { FileSystemAccessTransport } from './transport/fileSystemAccess';
import { pickBle, WebGattTransport } from './transport/webBluetooth';

/** Inside a page that offers its emulated device (opencc600's demo): Bluetooth goes to it, see `emulator.ts`. */
const emulator = emulatorOrigin();

/** Web: what the browser offers (Chrome and Edge have both, Safari neither). */
export const platform: MusettePlatform = {
  name: 'web',
  transports: emulator
    ? {
        gatt: (peer) => new EmulatorGattTransport(peer, emulator),
        blePick: (wanted) => pickEmulator(emulator, wanted),
        usbFiles: FileSystemAccessTransport.isSupported() ? () => new FileSystemAccessTransport() : undefined,
      }
    : {
        gatt: WebGattTransport.isSupported() ? (peer) => new WebGattTransport(peer) : undefined,
        blePick: WebGattTransport.isSupported() ? pickBle : undefined,
        usbFiles: FileSystemAccessTransport.isSupported() ? () => new FileSystemAccessTransport() : undefined,
      },
  pickLabel: emulator ? 'Connecter le compteur de la démo' : undefined,
  unsupported: 'Non pris en charge par ce navigateur (essayez Chrome ou Edge sur ordinateur).',
};
