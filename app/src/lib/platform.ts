import { Platform } from 'react-native';
import type { MusettePlatform } from './platform.types';
import { BlePlxGattTransport, scanBle } from './transport/blePlx';

/** iOS and Android: native Bluetooth. USB drives are not read yet. */
export const platform: MusettePlatform = {
  name: Platform.OS === 'ios' ? 'ios' : 'android',
  transports: {
    gatt: (peer) => new BlePlxGattTransport(peer),
    bleScan: scanBle,
  },
  unsupported: 'Pas encore pris en charge par l’appli mobile : utilisez la version web sur ordinateur.',
};
