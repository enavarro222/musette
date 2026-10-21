import { loadPlatformCore } from './load';
import type { Core } from './types';

export type * from './types';

let ready: Promise<Core> | undefined;

/** Load the Rust core once and return it. */
export function loadCore(): Promise<Core> {
  ready ??= loadPlatformCore();
  return ready;
}

/** Use this core instead of the platform's (tests). */
export function provideCore(core: Core): void {
  ready = Promise.resolve(core);
}
