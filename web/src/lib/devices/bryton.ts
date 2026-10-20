import { loadCore } from '../wasm';
import type { FileTransport } from '../transport/types';
import type { ActivityRef, Capabilities, Device } from './types';

/**
 * Bryton Rider 750 with stock firmware, connected over USB (mass storage).
 * See docs/drivers/bryton.md for what is known and what remains to test.
 */
export class BrytonUsbDevice implements Device {
  readonly model = 'bryton-rider-750' as const;
  readonly capabilities: Capabilities = {
    downloadActivities: true,
    uploadRoute: false, // pending the USB route-copy test
    routeCorridorMap: false,
    climbsOnDevice: false,
    settings: false,
    sensors: false,
    wifiSync: false,
  };

  constructor(private readonly transport: FileTransport) {}

  get name(): string {
    return 'Bryton Rider 750';
  }

  connect(): Promise<void> {
    return this.transport.connect();
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  async listActivities(): Promise<ActivityRef[]> {
    const [core, files] = await Promise.all([loadCore(), this.transport.list()]);
    return core.brytonFindActivities(
      files.map((f) => f.path),
      Float64Array.from(files.map((f) => f.size)),
    ) as ActivityRef[];
  }

  async downloadActivity(ref: ActivityRef, onProgress?: (r: number) => void): Promise<Uint8Array> {
    const bytes = await this.transport.read(ref.id);
    const core = await loadCore();
    core.verifyFit(bytes);
    onProgress?.(1);
    return bytes;
  }
}
