import { loadCore, type BrytonEvent, type BrytonInfo, type BrytonSession, type BrytonWrite, type ParsedRoute } from '../core';
import type { DeviceSettings, SettingValues } from '../settings';
import type { BleOptions, GattTransport } from '../transport/types';
import { bikeOf, shownFields, toField, toNumber, toValue } from './brytonSettings';
import type { ActivityRef, Capabilities, Device } from './types';

/** Keep in sync with crates/driver-bryton/src/ble.rs `uuid`. */
const COMMAND_SERVICE = '454d7788-a122-058d-9b42-9d0f3772af82';
const COMMAND_CHANNEL = '454d2288-a122-058d-9b42-9d0f3772af82';
const DATA_CHANNEL = '454d1188-a122-058d-9b42-9d0f3772af82';
const SETTING_SERVICE = '50b85566-c2de-a994-094d-340090726877';
const SETTING_CHANNEL = '50b81188-c2de-a994-094d-340090726877';

/** Channels of `BrytonWrite` / `onNotify`: keep in sync with musette-core `BRYTON_*`. */
const CHANNELS: [service: string, characteristic: string, withResponse: boolean][] = [
  [COMMAND_SERVICE, COMMAND_CHANNEL, true],
  [COMMAND_SERVICE, DATA_CHANNEL, false],
  [SETTING_SERVICE, SETTING_CHANNEL, true],
];

/**
 * Rider computers with Bryton's firmware. A Rider 750 advertises `0x2014`
 * and its name ("Rider750"); the protocol is in other services.
 */
export const BRYTON_BLE: BleOptions = {
  serviceUuid: '00002014-0000-1000-8000-00805f9b34fb',
  namePrefix: 'Rider',
  services: [COMMAND_SERVICE, SETTING_SERVICE],
};

/** Setting commands the device sends on its own (battery, every 5 s; notify, every 20 s). */
const PUSHED = new Set([24, 39]);
const RIDE_STORED = 51;
const ACK_OK = 10;

export interface BrytonTiming {
  /** A request fails after this long without command or data frames. */
  requestMs: number;
  /** How long to wait for the handshake after "new app". */
  readyMs: number;
}

const TIMING: BrytonTiming = { requestMs: 15_000, readyMs: 10_000 };

/** Unix seconds of a ride id (`yyMMddHHmmss`, the device's local time). */
export function rideStart(id: string): number | undefined {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(id);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(2000 + y, mo - 1, d, h, mi, s).getTime() / 1000;
}

function failure(e: BrytonEvent, what: string): Error {
  return new Error(`${what} : le compteur a refusé (${e.message})`);
}

/**
 * Bryton Rider 750 over Bluetooth, stock firmware. The protocol is in Rust
 * (`driver_bryton::ble`, through `musette_core::BrytonSession`); this class
 * moves bytes and waits for events. See docs/drivers/bryton-ble.md.
 */
export class BrytonBleDevice implements Device {
  readonly model = 'bryton-rider-750' as const;
  readonly capabilities: Capabilities = {
    downloadActivities: true,
    uploadRoute: true,
    routeCorridorMap: false,
    climbsOnDevice: false,
    settings: true,
    sensors: false,
    wifiSync: false,
  };

  info?: BrytonInfo;
  private session?: BrytonSession;
  private unsubscribe?: () => void;
  private listener?: (e: BrytonEvent) => void;
  /** Time of the last command or data frame: requests time out from it. */
  private lastActivity = 0;
  /** One request at a time, as the device does. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Notifications are handled one after the other, in order. */
  private incoming: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: GattTransport,
    private readonly timing: BrytonTiming = TIMING,
  ) {}

  get name(): string {
    return this.info?.model || this.transport.peerName || 'Bryton';
  }

  async connect(): Promise<void> {
    const core = await loadCore();
    this.session = core.brytonSession();
    await this.transport.connect();
    this.unsubscribe = this.transport.onNotify((c, b) => {
      this.incoming = this.incoming.then(() => this.onNotify(c, b)).catch(() => undefined);
    });
    await this.transport.subscribe(COMMAND_SERVICE, COMMAND_CHANNEL);
    await this.transport.subscribe(COMMAND_SERVICE, DATA_CHANNEL);
    this.info = await this.exchange((s) => s.readDeviceInfo(), (e) => e.info, 'Lecture du compteur');
    if (this.info.settings) {
      await this.transport.subscribe(SETTING_SERVICE, SETTING_CHANNEL);
      // The handshake gives the frame and batch sizes; without it, defaults.
      await this.exchange((s) => s.newApp(), (e) => (e.kind === 'ready' ? true : undefined), 'Connexion', {
        timeoutMs: this.timing.readyMs,
      }).catch(() => undefined);
    }
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.session?.free();
    this.session = undefined;
    await this.transport.disconnect();
  }

  async listActivities(): Promise<ActivityRef[]> {
    if (this.info?.recording) throw new Error('Le compteur enregistre une sortie : arrêtez-la pour copier les sorties.');
    const rides = await this.exchange((s) => s.listRides(), (e) => (e.kind === 'rides' ? e.rides : undefined), 'Liste des sorties');
    // The device lists only the rides not synced yet.
    return rides.map((r) => ({ id: r.id, startTime: rideStart(r.id), synced: false }));
  }

  async downloadActivity(ref: ActivityRef, onProgress?: (r: number) => void): Promise<Uint8Array> {
    const bytes = await this.exchange(
      (s) => s.download(ref.id),
      (e) => {
        if (e.kind === 'progress' && e.total > 0) onProgress?.(e.done / e.total);
        return e.kind === 'file' ? e.bytes : undefined;
      },
      'Téléchargement de la sortie',
    );
    (await loadCore()).verifyFit(bytes); // throws if truncated or corrupted
    onProgress?.(1);
    return bytes;
  }

  async acknowledgeActivity(ref: ActivityRef): Promise<void> {
    await this.setting((s) => s.acknowledge(ref.id), RIDE_STORED, 'Marquage de la sortie copiée');
  }

  async uploadRoute(route: ParsedRoute, onProgress?: (r: number) => void): Promise<void> {
    const core = await loadCore();
    const fit = core.brytonBuildRoute(route.lats, route.lons, route.eles);
    const id = this.info?.id ?? '';
    await this.exchange(
      (s) => s.sendRoute(fit, id),
      (e) => {
        if (e.kind === 'progress' && e.total > 0) onProgress?.(0.95 * (e.done / e.total));
        return e.kind === 'sent' ? true : undefined;
      },
      'Envoi de l’itinéraire',
    );
    // The name makes the device import the route.
    await this.exchange(
      (s) => s.sendRouteName(route.name.trim() || 'Musette'),
      (e) => (e.kind === 'routeNamed' ? true : undefined),
      'Nom de l’itinéraire',
    );
    onProgress?.(1);
  }

  async readSettings(): Promise<DeviceSettings> {
    const core = await loadCore();
    const all = shownFields(core.brytonSettingFields());
    const values: SettingValues = {};
    const bikeNames: (string | undefined)[] = [];
    const fields = [];
    for (const f of all) {
      let cmd = -1;
      const frame = await this.exchange(
        (s) => {
          const w = s.settingGet(f.key);
          cmd = w.bytes[0];
          return w;
        },
        // The answer, or the same frame pushed by the device (battery).
        (e) => (e.kind === 'setting' && e.cmd === cmd ? e.bytes : undefined),
        'Lecture des réglages',
        { setting: true },
      );
      const v = core.brytonSettingValue(f.key, frame);
      if (!v) continue;
      const bike = bikeOf(f.key);
      if (bike?.[1] === 'name') {
        bikeNames[bike[0]] = v.text || undefined;
        continue;
      }
      const field = toField(f, bikeNames);
      if (!field) continue;
      fields.push(field);
      values[f.key] = toValue(f, v);
    }
    return { fields, values };
  }

  async writeSettings(changes: SettingValues): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('Non connecté');
    // Rust checks every value before anything is sent: a bad one changes nothing.
    const writes: [BrytonWrite, number][] = Object.entries(changes).map(([key, v]) => {
      const w = session.settingSet(key, toNumber(v));
      return [w, w.bytes[0]];
    });
    for (const [w, cmd] of writes) await this.setting(() => w, cmd, 'Réglage');
  }

  // ---- requests ------------------------------------------------------

  /** Writes one setting frame and waits for the device's ack of `cmd`. */
  private setting(first: (s: BrytonSession) => BrytonWrite, cmd: number, what: string): Promise<void> {
    return this.exchange(
      first,
      (e) => {
        if (e.kind !== 'settingAck' || e.cmd !== cmd) return undefined;
        if (e.status !== ACK_OK) throw new Error(`${what} : le compteur a refusé (statut ${e.status})`);
        return true;
      },
      what,
      { setting: true },
    ).then(() => undefined);
  }

  /**
   * Writes what `first` returns, then feeds notifications to the session
   * until `pick` returns a value. Fails on a `failed` event, or after
   * `requestMs` without command or data frames (setting frames count when
   * `setting`: answers to settings come there).
   */
  private exchange<T>(
    first: (s: BrytonSession) => BrytonWrite,
    pick: (e: BrytonEvent) => T | undefined,
    what: string,
    opts: { timeoutMs?: number; setting?: boolean } = {},
  ): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        const session = this.session;
        if (!session) return reject(new Error('Non connecté'));
        const limit = opts.timeoutMs ?? this.timing.requestMs;
        const finish = (error?: Error, value?: T) => {
          clearInterval(timer);
          this.listener = undefined;
          if (error) reject(error);
          else resolve(value as T);
        };
        this.lastActivity = Date.now();
        const timer = setInterval(() => {
          if (Date.now() - this.lastActivity > limit) finish(new Error(`${what} : le compteur ne répond pas`));
        }, Math.min(500, limit));
        this.listener = (e) => {
          if (opts.setting && (e.kind === 'setting' || e.kind === 'settingAck') && !PUSHED.has(e.cmd)) {
            this.lastActivity = Date.now();
          }
          if (e.kind === 'failed') return finish(failure(e, what));
          try {
            const v = pick(e);
            if (v !== undefined) finish(undefined, v);
          } catch (err) {
            finish(err as Error);
          }
        };
        this.write(first(session)).catch((err: Error) => finish(err));
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(w: BrytonWrite): Promise<void> {
    const [service, characteristic, withResponse] = CHANNELS[w.channel];
    await this.transport.write(service, characteristic, w.bytes, withResponse);
  }

  private async onNotify(characteristic: string, bytes: Uint8Array): Promise<void> {
    const channel = CHANNELS.findIndex(([, c]) => c === characteristic.toLowerCase());
    if (channel < 0 || !this.session) return;
    if (channel !== 2) this.lastActivity = Date.now();
    const step = this.session.onNotify(channel, bytes);
    // In order: answers to the device (acks, next batch) before anything else.
    for (const w of step.writes) await this.write(w);
    for (const e of step.events) this.listener?.(e);
  }
}
