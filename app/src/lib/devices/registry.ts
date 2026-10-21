import type { BleOptions, BlePeer, GattTransport, PacketTransport, TransportFactories } from '../transport/types';
import { BrytonUsbDevice } from './bryton';
import { BRYTON_BLE, BrytonBleDevice } from './brytonBle';
import { CC600_BLE, Cc600Device } from './cc600';
import { FakeCc600, fitFile } from '../../test/fakeCc600';
import type { Device, ModelId } from './types';

export interface ModelEntry {
  id: ModelId;
  label: string;
  /** Short hint shown when pairing. */
  connectHint: string;
  /**
   * A Bluetooth device: how to recognise it. The user does not pick the
   * model: one search finds every Bluetooth model, and the device found
   * tells which one it is (`modelOf`).
   */
  ble?: {
    options: BleOptions;
    /** Shown under the Bluetooth search (else `connectHint`). */
    hint?: string;
    /** One write and one notify characteristic. */
    open?(transport: PacketTransport): Device;
    /** Several characteristics. */
    openGatt?(transport: GattTransport): Device;
  };
  /** Any other device. Returns undefined when the platform lacks the needed transport. */
  create?(transports: TransportFactories): Device | undefined;
}

// Development only: a CC600 simulated in the page, to try the app without a device.
const SIMULATED: ModelEntry[] = __DEV__
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
    connectHint: 'Sur le CC600 : Menu › Associer.',
    ble: { options: CC600_BLE, open: (t) => new Cc600Device(t) },
  },
  {
    id: 'bryton-rider-750',
    label: 'Bryton Rider 750',
    connectHint: 'Branchez le compteur en USB, puis sélectionnez le lecteur « Bryton ».',
    ble: {
      options: BRYTON_BLE,
      hint: 'Bryton : allumez le compteur, débranché de l’USB, et fermez Bryton Active sur le téléphone.',
      openGatt: (t) => new BrytonBleDevice(t),
    },
    create: (t) => (t.usbFiles ? new BrytonUsbDevice(t.usbFiles()) : undefined),
  },
  ...SIMULATED,
];

/** The models found by a Bluetooth search. */
export const BLE_MODELS = MODELS.filter((m) => m.ble);

/** The model of a Bluetooth device found by a search. */
export function modelOf(peer: BlePeer): ModelEntry {
  return BLE_MODELS.find((m) => m.ble!.options === peer.options)!;
}

/** Open a Bluetooth device found by a search, undefined where the platform has no Bluetooth. */
export function openBle(transports: TransportFactories, peer: BlePeer): Device | undefined {
  const ble = modelOf(peer).ble!;
  if (ble.openGatt) return transports.gatt ? ble.openGatt(transports.gatt(peer)) : undefined;
  return transports.ble && ble.open ? ble.open(transports.ble(peer)) : undefined;
}
