import type { TransportFactories } from '../transport/types';
import { BrytonUsbDevice } from './bryton';
import { CC600_BLE, Cc600Device } from './cc600';
import type { Device, ModelId } from './types';

export interface ModelEntry {
  id: ModelId;
  label: string;
  /** Short hint shown when pairing. */
  connectHint: string;
  /** Returns undefined when the platform lacks the needed transport. */
  create(transports: TransportFactories): Device | undefined;
}

export const MODELS: ModelEntry[] = [
  {
    id: 'open-cc600',
    label: 'CC600 (firmware OpenCC600)',
    connectHint: 'Sur le compteur : Menu › Associer, puis choisissez-le dans la liste.',
    create: (t) => (t.ble ? new Cc600Device(t.ble(CC600_BLE)) : undefined),
  },
  {
    id: 'bryton-rider-750',
    label: 'Bryton Rider 750',
    connectHint: 'Branchez le compteur en USB, puis sélectionnez le lecteur « Bryton ».',
    create: (t) => (t.usbFiles ? new BrytonUsbDevice(t.usbFiles()) : undefined),
  },
];
