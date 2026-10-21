import { Asset } from 'expo-asset';
import init, * as wasm from './wasm/musette_wasm';
import type { Core } from './types';
import { wasmCore } from './wasm';

// Metro serves the .wasm as an asset (metro.config.js); wasm-bindgen's own
// lookup (`import.meta.url`) does not work with Metro.
const module = require('./wasm/musette_wasm_bg.wasm');

/** Web: the WASM build of the Rust core. */
export async function loadPlatformCore(): Promise<Core> {
  await init({ module_or_path: Asset.fromModule(module).uri });
  return wasmCore(wasm);
}
