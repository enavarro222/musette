import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import { matchBle, type BleOptions, type BlePeer, type GattTransport } from './types';

/**
 * Native Bluetooth (iOS, Android) through react-native-ble-plx.
 *
 * There is no device chooser as in the browser: the app lists the devices
 * `scanBle` finds and connects to the one the user picks.
 */
export class BlePlxGattTransport implements GattTransport {
  readonly kind = 'gatt' as const;
  peerName?: string;
  /** The negotiated MTU less the ATT header. */
  maxWrite = 20;

  private device?: Device;
  private monitors: Subscription[] = [];
  private listeners = new Set<(characteristic: string, bytes: Uint8Array) => void>();

  constructor(private readonly peer: BlePeer) {}

  async connect(): Promise<void> {
    const ble = manager();
    await ready(ble);
    const device = await ble.connectToDevice(this.peer.id, { requestMTU: 247 });
    await device.discoverAllServicesAndCharacteristics();
    this.device = device;
    this.peerName = device.name ?? device.localName ?? undefined;
    this.maxWrite = Math.max(20, Math.min(device.mtu - 3, 244));
  }

  async disconnect(): Promise<void> {
    this.monitors.forEach((m) => m.remove());
    this.monitors = [];
    await this.device?.cancelConnection().catch(() => undefined);
    this.device = undefined;
  }

  async subscribe(service: string, characteristic: string): Promise<void> {
    if (!this.device) throw new Error('Non connecté');
    this.monitors.push(
      this.device.monitorCharacteristicForService(service, characteristic, (error, c) => {
        if (error || !c?.value) return;
        const bytes = fromBase64(c.value);
        this.listeners.forEach((l) => l(c.uuid.toLowerCase(), bytes));
      }),
    );
  }

  async write(service: string, characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void> {
    if (!this.device) throw new Error('Non connecté');
    const value = toBase64(bytes);
    if (withResponse) await this.device.writeCharacteristicWithResponseForService(service, characteristic, value);
    else await this.device.writeCharacteristicWithoutResponseForService(service, characteristic, value);
  }

  onNotify(listener: (characteristic: string, bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Report the devices around that advertise one of the services and whose
 * name starts with its `namePrefix`, each once (then again when its signal
 * changes).
 */
export function scanBle(
  wanted: BleOptions[],
  onFound: (peer: BlePeer) => void,
  onError: (e: Error) => void,
): () => void {
  const ble = manager();
  let stopped = false;
  void ready(ble)
    .then(() => {
      if (stopped) return;
      void ble.startDeviceScan(
        wanted.map((o) => o.serviceUuid),
        null,
        (error, device) => {
          if (error) return onError(new Error(`Recherche Bluetooth impossible : ${error.message}`));
          if (!device) return;
          const name = device.name ?? device.localName ?? '';
          const options = matchBle(wanted, name);
          if (options) onFound({ id: device.id, name, rssi: device.rssi ?? undefined, options });
        },
      );
    })
    .catch(onError);
  return () => {
    stopped = true;
    void ble.stopDeviceScan();
  };
}

let shared: BleManager | undefined;

/** One manager for the app, as react-native-ble-plx requires. */
function manager(): BleManager {
  shared ??= new BleManager();
  return shared;
}

/** Permissions granted and Bluetooth on, or a French error. */
async function ready(ble: BleManager): Promise<void> {
  await askPermissions();
  await poweredOn(ble);
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
