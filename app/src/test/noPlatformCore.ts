import type { Core } from '../lib/core/types';

/** Tests load the core in setup.ts; nothing else may. */
export function loadPlatformCore(): Promise<Core> {
  return Promise.reject(new Error('tests: the core is given by src/test/setup.ts'));
}
