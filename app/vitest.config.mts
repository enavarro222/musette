import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __DEV__: 'true' },
  resolve: {
    alias: [
      // The tests give the core themselves (src/test/setup.ts); the platform
      // loaders need Metro (asset) or the native module.
      { find: /^\.\/load$/, replacement: fileURLToPath(new URL('./src/test/noPlatformCore.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
