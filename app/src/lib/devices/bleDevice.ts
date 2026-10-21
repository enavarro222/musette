import {
  loadCore,
  type Channel,
  type DeviceActivity,
  type DeviceField,
  type DeviceSetting,
  type Failure,
  type FileKind,
  type ModelId,
  type Outcome,
  type ParsedRoute,
  type Session,
  type Step,
  type Timing,
} from '../core';
import type { DeviceSettings, SettingValue, SettingValues } from '../settings';
import type { GattTransport } from '../transport/types';
import { NO_CAPABILITIES, type ActivityRef, type Capabilities, type Device } from './types';

/**
 * What the app adds to a Bluetooth model: words. Its protocol, channels,
 * capabilities and settings are in Rust (`musette_core::Session`).
 */
export interface BleModel {
  id: ModelId;
  /** Shown when the device does not give its name. */
  name: string;
  /** The settings as the settings screen shows them: labels, Musette groups. */
  presentSettings(fields: DeviceField[], values: DeviceSetting[]): DeviceSettings;
  /** Musette's name of a setting, for messages. */
  settingLabel(key: string): string;
}

/** Musette's words for what a device answers (`Failure` codes). */
const FAILURES: Partial<Record<Failure['code'], string>> = {
  stalled: 'Le compteur ne répond plus. Relancez l’envoi : il reprendra où il s’est arrêté.',
  corrupted: 'La sortie est arrivée abîmée : relancez la copie.',
  interrupted: 'Transfert interrompu',
  recording: 'Le compteur enregistre une sortie : arrêtez-la pour copier les sorties.',
  badRequest: 'Le compteur a refusé la demande',
  noSpace: 'Pas assez de place sur le compteur',
  noTransfer: 'Le compteur a perdu le transfert en cours',
  incomplete: 'Le fichier est arrivé incomplet',
  badCrc: 'Le fichier a été abîmé pendant l’envoi : renvoyez-le',
  busy: 'Le compteur est occupé (sortie en cours ?)',
  storage: 'Le compteur n’a pas pu écrire le fichier',
};

/** The generic value of a setting, as the settings screen holds it. */
export function settingValue(f: DeviceField, v: DeviceSetting): SettingValue {
  switch (f.kind) {
    case 'bool':
      return v.number === 1;
    case 'number':
      return Math.round((v.number ?? 0) * 10) / 10;
    default:
      return v.text;
  }
}

/** A value from the settings screen, for the session. */
export function settingChange(key: string, v: SettingValue): DeviceSetting {
  if (typeof v === 'boolean') return { key, number: v ? 1 : 0, text: '' };
  if (typeof v === 'number') return { key, number: v, text: String(v) };
  return { key, text: v };
}

/** Unix seconds of a device's wall clock read as UTC, in this time zone. */
function localStart(a: DeviceActivity): number | undefined {
  if (a.startTime === undefined || !a.localTime) return a.startTime;
  return a.startTime + new Date(a.startTime * 1000).getTimezoneOffset() * 60;
}

interface Pending {
  what: string;
  resolve(o: Outcome): void;
  reject(e: Error): void;
  onProgress?(ratio: number): void;
}

/**
 * Any Bluetooth device: the Rust session decides, this class moves bytes,
 * arms the timer the session asks for and words the failures. One request at
 * a time, as the devices do.
 */
export class BleDevice implements Device {
  readonly model: ModelId;
  capabilities: Capabilities = NO_CAPABILITIES;
  private session?: Session;
  private channels: Channel[] = [];
  private info?: { name: string; recording: boolean };
  private pending?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  /** Requests, one after the other. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Steps, applied in the order the session gave them. */
  private steps: Promise<void> = Promise.resolve();

  constructor(
    private readonly profile: BleModel,
    private readonly transport: GattTransport,
    private readonly timing?: Timing,
  ) {
    this.model = profile.id;
  }

  get name(): string {
    return this.info?.name || this.transport.peerName || this.profile.name;
  }

  async connect(): Promise<void> {
    const core = await loadCore();
    this.capabilities = core.capabilities(this.model, 'ble');
    this.session?.free();
    this.session = core.session(this.model, this.timing);
    this.channels = this.session.channels();
    await this.transport.connect();
    this.unsubscribe?.();
    this.unsubscribe = this.transport.onNotify((characteristic, bytes) => this.onNotify(characteristic, bytes));
    const info = await this.run((s) => s.connect(), 'Connexion');
    if (info.kind === 'info') this.info = info;
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.setTimer(0);
    this.pending?.reject(new Error('Compteur déconnecté'));
    this.pending = undefined;
    this.session?.free();
    this.session = undefined;
    await this.transport.disconnect();
  }

  async listActivities(): Promise<ActivityRef[]> {
    const o = await this.run((s) => s.listActivities(), 'Liste des sorties');
    if (o.kind !== 'activities') return [];
    return o.activities.map((a) => ({ id: a.id, startTime: localStart(a), size: a.size, synced: a.synced }));
  }

  async downloadActivity(ref: ActivityRef, onProgress?: (r: number) => void): Promise<Uint8Array> {
    const o = await this.run((s) => s.download(ref.id, ref.size), 'Téléchargement de la sortie', onProgress);
    if (o.kind !== 'file') throw new Error('Téléchargement de la sortie : rien reçu');
    return o.bytes;
  }

  async acknowledgeActivity(ref: ActivityRef, _fit?: Uint8Array): Promise<void> {
    await this.run((s) => s.acknowledge(ref.id), 'Marquage de la sortie copiée');
  }

  async uploadRoute(route: ParsedRoute, onProgress?: (r: number) => void): Promise<void> {
    await this.run((s) => s.sendRoute(route), 'Envoi de l’itinéraire', onProgress);
  }

  async uploadFile(kind: FileKind, bytes: Uint8Array, onProgress?: (r: number) => void): Promise<void> {
    await this.run((s) => s.sendFile(kind, bytes), 'Envoi du fichier', onProgress);
  }

  async readSettings(): Promise<DeviceSettings> {
    const o = await this.run((s) => s.readSettings(), 'Lecture des réglages');
    if (o.kind !== 'settings') return { fields: [], values: {} };
    return this.profile.presentSettings(o.fields, o.values);
  }

  async writeSettings(changes: SettingValues): Promise<void> {
    const list = Object.entries(changes).map(([key, v]) => settingChange(key, v));
    if (list.length === 0) return;
    await this.run((s) => s.writeSettings(list), 'Réglage');
  }

  // ---- the session -----------------------------------------------------

  /** Starts a request after the ones under way; resolves with its outcome, rejects with Musette's words. */
  private run(start: (s: Session) => Step, what: string, onProgress?: (r: number) => void): Promise<Outcome> {
    const go = () =>
      new Promise<Outcome>((resolve, reject) => {
        const session = this.session;
        if (!session) return reject(new Error('Non connecté'));
        let step: Step;
        try {
          step = start(session);
        } catch (e) {
          // Refused before anything was sent (a value the device cannot take).
          return reject(new Error(`${what} : ${e instanceof Error ? e.message : String(e)}`));
        }
        this.pending = { what, resolve, reject, onProgress };
        this.apply(step);
      });
    const next = this.queue.then(go, go);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private onNotify(characteristic: string, bytes: Uint8Array): void {
    const channel = this.channels.findIndex((c) => c.characteristic === characteristic.toLowerCase());
    if (channel < 0 || !this.session) return;
    this.apply(this.session.onNotify(channel, bytes));
  }

  private onTimeout(): void {
    this.timer = undefined;
    if (this.session) this.apply(this.session.onTimeout());
  }

  /** Queues a step: its subscriptions, writes, progress, timer and outcome, in that order. */
  private apply(step: Step): void {
    // The device answered: the old timer must not fire before this step is applied.
    if (step.waitMs !== undefined) this.setTimer(0);
    this.steps = this.steps.then(() => this.applyNow(step)).catch((e: Error) => this.finish(undefined, e));
  }

  private async applyNow(step: Step): Promise<void> {
    for (const c of step.subscribe) {
      const ch = this.channels[c];
      await this.transport.subscribe(ch.service, ch.characteristic);
    }
    for (const w of step.writes) await this.write(w.channel, w.bytes);
    if (step.progress !== undefined) this.pending?.onProgress?.(step.progress);
    if (step.waitMs !== undefined) this.setTimer(step.waitMs);
    if (step.outcome) this.finish(step.outcome);
  }

  private async write(channel: number, bytes: Uint8Array): Promise<void> {
    const c = this.channels[channel];
    const size = c.split ? (this.transport.maxWrite ?? bytes.length) : bytes.length;
    for (let i = 0; i < bytes.length; i += Math.max(1, size)) {
      await this.transport.write(c.service, c.characteristic, bytes.subarray(i, i + size), c.withResponse);
    }
  }

  private setTimer(ms: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = ms > 0 ? setTimeout(() => this.onTimeout(), ms) : undefined;
  }

  private finish(outcome?: Outcome, error?: Error): void {
    const p = this.pending;
    this.pending = undefined;
    if (!p) return;
    if (error) return p.reject(error);
    if (outcome?.kind === 'failed') return p.reject(new Error(this.words(outcome, p.what)));
    if (outcome) p.resolve(outcome);
  }

  private words(f: Failure, what: string): string {
    switch (f.code) {
      case 'timeout':
        return `${what} : le compteur ne répond pas`;
      case 'refused':
        return `${what} : le compteur a refusé (${f.detail})`;
      case 'badSetting':
        return `Le compteur a refusé le réglage « ${this.profile.settingLabel(f.detail)} »`;
      default:
        return FAILURES[f.code] ?? `${what} : erreur du compteur (${f.code})`;
    }
  }
}
