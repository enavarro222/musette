// Node has no fetch for the .wasm next to the module: load the Rust core from its bytes once.
// `loadCore()` then finds it already initialized.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import init from '../lib/wasm/pkg/musette_wasm';

await init({ module_or_path: readFileSync(fileURLToPath(new URL('../lib/wasm/pkg/musette_wasm_bg.wasm', import.meta.url))) });
