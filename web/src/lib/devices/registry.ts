import type { TransportFactories } from '../transport/types';
import { BrytonUsbDevice } from './bryton';
import { CC600_BLE, Cc600Device } from './cc600';
import { FakeCc600, fitFile } from '../../test/fakeCc600';
import type { Device, ModelId } from './types';

export interface ModelEntry {
  id: ModelId;
  label: string;
  /** Short hint shown when pairing. */
  connectHint: string;
  /** Returns undefined when the platform lacks the needed transport. */
  create(transports: TransportFactories): Device | undefined;
}

// Development only: a CC600 simulated in the page, to try the app without a device.
const SIMULATED: ModelEntry[] = import.meta.env.DEV
  ? [
      {
        id: 'open-cc600',
        label: 'CC600 simulé (développement)',
        connectHint: 'Aucun appareil : les échanges passent par le code Rust du compteur, dans la page.',
        create: () =>
          new Cc600Device(
            new FakeCc600({
              settings: 'hr=ant:120:4242:1\n',
              activities: [{ id: 1, startTime: 1_790_000_000, fit: fitFile(new Uint8Array(2000)) }],
            }),
          ),
      },
    ]
  : [];

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
  ...SIMULATED,
];
