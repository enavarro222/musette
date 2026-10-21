import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import type { BleOptions, PacketTransport } from './types';

/**
 * Native Bluetooth (iOS, Android) through react-native-ble-plx.
 *
 * There is no device chooser as in the browser: `connect` takes the first
 * device that advertises the service and whose name starts with
 * `namePrefix`.
 *
 * Not yet tried with a real CC600.
 */
export class BlePlxTransport implements PacketTransport {
  readonly kind = 'packet' as const;
  peerName?: string;

  private device?: Device;
  private monitor?: Subscription;
  private listeners = new Set<(bytes: Uint8Array) => void>();
  /** Bytes per write: the negotiated MTU less the ATT header. */
  private chunkSize = 20;

  constructor(
    private readonly options: BleOptions,
    private readonly scanMs = 15_000,
  ) {}

  async connect(): Promise<void> {
    const ble = manager();
    await askPermissions();
    await poweredOn(ble);
    const found = await this.scan(ble);
    const device = await found.connect({ requestMTU: 247 });
    await device.discoverAllServicesAndCharacteristics();
    this.device = device;
    this.peerName = device.name ?? device.localName ?? undefined;
    this.chunkSize = Math.max(20, Math.min(device.mtu - 3, 244));
    this.monitor = device.monitorCharacteristicForService(this.options.serviceUuid, this.options.txUuid, (error, c) => {
      if (error || !c?.value) return;
      const bytes = fromBase64(c.value);
      this.listeners.forEach((l) => l(bytes));
    });
  }

  async disconnect(): Promise<void> {
    this.monitor?.remove();
    this.monitor = undefined;
    await this.device?.cancelConnection().catch(() => undefined);
    this.device = undefined;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('Non connecté');
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      await this.device.writeCharacteristicWithoutResponseForService(
        this.options.serviceUuid,
        this.options.rxUuid,
        toBase64(bytes.subarray(i, i + this.chunkSize)),
      );
    }
  }

  onData(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scan(ble: BleManager): Promise<Device> {
    const { serviceUuid, namePrefix } = this.options;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void ble.stopDeviceScan();
        reject(new Error('Aucun compteur trouvé. Est-il allumé, en mode association, et à côté du téléphone ?'));
      }, this.scanMs);
      void ble.startDeviceScan([serviceUuid], null, async (error, device) => {
        if (error) {
          clearTimeout(timer);
          void ble.stopDeviceScan();
          return reject(new Error(`Recherche Bluetooth impossible : ${error.message}`));
        }
        const name = device?.name ?? device?.localName ?? '';
        if (device && name.startsWith(namePrefix)) {
          clearTimeout(timer);
          await ble.stopDeviceScan();
          resolve(device);
        }
      });
    });
  }
}

let shared: BleManager | undefined;

/** One manager for the app, as react-native-ble-plx requires. */
function manager(): BleManager {
  shared ??= new BleManager();
  return shared;
}

async function askPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS asks by itself (NSBluetoothAlwaysUsageDescription)
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (wanted.some((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error('Musette a besoin de l’autorisation « Appareils à proximité » pour trouver le compteur.');
  }
}

function poweredOn(ble: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Activez le Bluetooth du téléphone.'));
    }, 5_000);
    const sub = ble.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        sub.remove();
        resolve();
      } else if (state === State.Unauthorized) {
        clearTimeout(timer);
        sub.remove();
        reject(new Error('Musette n’a pas accès au Bluetooth (réglages du téléphone).'));
      }
    }, true);
  });
}

// GATT values travel as base64 in react-native-ble-plx.
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
