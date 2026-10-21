/// <reference types="node" />
// Node has no fetch for the .wasm: load the Rust core from its bytes, once,
// and give it to the app (`loadCore()` then returns it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { provideCore } from '../lib/core';
import { wasmCore } from '../lib/core/wasm';
import init, * as wasm from '../lib/core/wasm/musette_wasm';

const bytes = readFileSync(fileURLToPath(new URL('../lib/core/wasm/musette_wasm_bg.wasm', import.meta.url)));
await init({ module_or_path: bytes });
provideCore(wasmCore(wasm));
