const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The web build loads the Rust core as a .wasm asset (src/lib/core/load.ts).
config.resolver.assetExts.push('wasm');

module.exports = config;
