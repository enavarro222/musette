import type { BleOptions, BlePeer, GattTransport } from './types';

/**
 * The emulated device of a page that embeds the app in an iframe (opencc600's in-browser demo: the firmware runs
 * in esp32sim, whose virtual BLE central the page drives). Web only, and only when the page asks for it with
 * `?emulator=<its origin>` in the iframe's URL: messages are exchanged with that origin alone.
 *
 * Protocol (`window.postMessage`, every message has `gatt`):
 * - app → page: `{gatt: 'hello' | 'connect' | 'disconnect' | 'subscribe' | 'write', id, service?, characteristic?,
 *   bytes?: number[], withResponse?}`
 * - page → app: `{gatt: 'reply', id, ok, error?, name?, serviceUuid?, mtu?}` (`hello` answers the device's name and
 *   advertised service, `connect` the link's ATT MTU; 23 when not said), `{gatt: 'notify', characteristic,
 *   bytes: number[]}`
 */
export const EMULATOR_PARAM = 'emulator';

/** The origin of the page that embeds the app and offers its emulated device, if it does. */
export function emulatorOrigin(): string | undefined {
  if (typeof window === 'undefined' || window.parent === window) return undefined;
  const origin = new URLSearchParams(window.location.search).get(EMULATOR_PARAM);
  if (!origin) return undefined;
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

type Reply = { ok: boolean; error?: string; name?: string; serviceUuid?: string; mtu?: number };

/** Requests to the page, each answered by a `reply` with its id. */
class PageLink {
  private next = 1;
  private waiting = new Map<number, (r: Reply) => void>();
  readonly listeners = new Set<(characteristic: string, bytes: Uint8Array) => void>();

  readonly win = window;

  constructor(readonly origin: string) {
    this.win.addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== this.origin || e.source !== window.parent || !e.data || typeof e.data.gatt !== 'string') return;
      const m = e.data;
      if (m.gatt === 'reply') {
        const r = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        r?.(m);
      } else if (m.gatt === 'notify' && Array.isArray(m.bytes)) {
        const bytes = Uint8Array.from(m.bytes);
        this.listeners.forEach((l) => l(String(m.characteristic).toLowerCase(), bytes));
      }
    });
  }

  async ask(gatt: string, fields: Record<string, unknown> = {}): Promise<Reply> {
    const id = this.next++;
    const reply = new Promise<Reply>((res) => this.waiting.set(id, res));
    window.parent.postMessage({ gatt, id, ...fields }, this.origin);
    const r = await reply;
    if (!r.ok) throw new Error(r.error || `Compteur de la démo : ${gatt} a échoué`);
    return r;
  }
}

let link: PageLink | undefined;
const pageLink = (origin: string) =>
  (link = link && link.win === window && link.origin === origin ? link : new PageLink(origin));

/** The page's device, as the profile among `wanted` whose service it advertises. */
export async function pickEmulator(origin: string, wanted: BleOptions[]): Promise<BlePeer> {
  const r = await pageLink(origin).ask('hello');
  const options = wanted.find((o) => o.serviceUuid === r.serviceUuid?.toLowerCase());
  if (!options) throw new Error(`Appareil de la démo non reconnu : ${r.name ?? '?'}`);
  return { id: 'emulator', name: r.name ?? 'Compteur de la démo', options };
}

export class EmulatorGattTransport implements GattTransport {
  readonly kind = 'gatt' as const;
  peerName?: string;
  /** The link's ATT MTU less 3, once connected (the page asks the emulator for a larger MTU). */
  maxWrite = 20;
  private readonly link: PageLink;

  constructor(
    private readonly peer: BlePeer,
    origin: string,
  ) {
    this.link = pageLink(origin);
  }

  async connect(): Promise<void> {
    const r = await this.link.ask('connect');
    this.maxWrite = Math.max(20, Math.min((r.mtu ?? 23) - 3, 244));
    this.peerName = this.peer.name;
  }

  async disconnect(): Promise<void> {
    await this.link.ask('disconnect');
  }

  async subscribe(service: string, characteristic: string): Promise<void> {
    await this.link.ask('subscribe', { service, characteristic });
  }

  async write(service: string, characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void> {
    await this.link.ask('write', { service, characteristic, bytes: Array.from(bytes), withResponse });
  }

  onNotify(listener: (characteristic: string, bytes: Uint8Array) => void): () => void {
    this.link.listeners.add(listener);
    return () => this.link.listeners.delete(listener);
  }
}
