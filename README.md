# Musette

**The free companion app for bike computers.** Runs in your browser, no account, no cloud: your rides stay on your device.

> *Musette* — the bag of food handed to riders during a race. This app hands routes to your bike computer and brings your rides back.

Musette is first built to use and share the [OpenCC600](https://github.com/enavarro222/opencc600) firmware (GEOID CC600) while it is being developed, and is designed to support other bike computers too (Bryton Rider 750 with its stock firmware is next).

## What it does

| | OpenCC600 (Bluetooth) | Bryton Rider 750 (USB) |
|---|---|---|
| Download rides (FIT), verified before being acknowledged | ✓ (protocol draft) | ✓ (folder heuristics to confirm) |
| Open a GPX, elevation profile, climb detection | ✓ | ✓ |
| Send a route to the device | planned | to investigate |
| Device settings, sensors | planned | — |

Browser support: **Chrome / Edge** (desktop and Android) for Bluetooth; **desktop Chrome / Edge** for USB drives. Safari and Firefox do not support Web Bluetooth.

## Repository layout

```
crates/
  protocol-cc600   wire protocol shared with the firmware (no_std, no alloc, no deps)
  fit              FIT integrity checks (header + CRC)
  track            distances, elevation profile, ascent, simplification
  climbs           climb detection and categories
  device           device models and capabilities
  driver-bryton    Bryton stock-firmware driver (USB mass storage)
  musette-wasm     WebAssembly bindings for the web app
web/               Svelte 5 + Vite app (PWA)
docs/              architecture and driver notes
```

See [docs/architecture.md](docs/architecture.md).

## Develop

Requirements: Rust (stable) with the `wasm32-unknown-unknown` target, [wasm-pack](https://rustwasm.github.io/wasm-pack/), Node 22.

```sh
cargo test --workspace          # core logic
cd web
npm install
npm run wasm                    # build the Rust core to web/src/lib/wasm/pkg
npm run dev                     # http://localhost:5173 (Web Bluetooth works on localhost)
```

Every push to `main` is built by CI and deployed to GitHub Pages.

## License

MIT — see [LICENSE](LICENSE). The OpenCC600 firmware is GPL-3.0; it talks to Musette over a protocol and shares only the MIT `protocol-cc600` crate, which must never contain code derived from GPL sources.
