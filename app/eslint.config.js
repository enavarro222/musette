const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'coverage/**',
      'modules/musette-native/src/**', // Generated UniFFI bindings and module entry point.
      'src/lib/core/wasm/**',
      'public/maplibre-gl-worker.mjs',
    ],
  },
  expoConfig,
]);
