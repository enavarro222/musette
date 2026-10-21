import { Platform } from 'react-native';
import type { MusettePlatform } from './platform.types';
import { BlePlxTransport } from './transport/blePlx';

/** iOS and Android: native Bluetooth. USB drives are not read yet. */
export const platform: MusettePlatform = {
  name: Platform.OS === 'ios' ? 'ios' : 'android',
  transports: {
    ble: (o) => new BlePlxTransport(o),
  },
  unsupported: 'Pas encore pris en charge par l’appli mobile : utilisez la version web sur ordinateur.',
};
