# Musette

**The free companion app for bike computers.** In your browser, on Android and on iOS. No account, no cloud: your rides stay on your device.

> *Musette* — the bag of food handed to riders during a race. This app hands routes to your bike computer and brings your rides back.

Musette is first built to use and share the [OpenCC600](https://github.com/enavarro222/opencc600) firmware (GEOID CC600) while it is being developed, and is designed to support other bike computers too: the Bryton Rider 750 with its stock firmware is the second one.

## What it does

| | OpenCC600 (Bluetooth) | Bryton Rider 750 (Bluetooth, USB) |
|---|---|---|
| Download rides (FIT), verified before being acknowledged | ✓ | ✓ (USB: folder heuristics to confirm) |
| Open a GPX, elevation profile, climb detection | ✓ | ✓ |
| Send a route to the device | ✓ with its climbs | ✓ Bluetooth (start and arrival turns only) |
| Device settings | ✓ | ✓ Bluetooth |

Where it runs:

- **Web**: Chrome / Edge (desktop and Android) for Bluetooth; desktop Chrome / Edge for USB drives. Safari and Firefox do not support Web Bluetooth.
- **Android, iOS**: native app (Bluetooth). USB drives are not read yet. Android is used with a real CC600 and a Rider 750; iOS is not tried yet.

## Repository layout

```
crates/
  protocol-cc600   wire protocol shared with the firmware (no_std, no alloc, no deps)
  route-cc600      CC600 route (OCRT, with its climbs) and corridor map (OCMP) files, shared with the firmware
  settings-cc600   CC600 settings file, shared with the firmware
  fit              FIT integrity checks (header + CRC)
  track            distances, elevation profile, ascent, simplification
  climbs           climb detection and categories
  device           device models and capabilities
  driver-bryton    Bryton stock-firmware driver (USB mass storage, Bluetooth)
  driver-cc600     app side of the CC600 protocol, and a CC600 in memory
  musette-core     what the app asks of the crates, one device session for every model
  musette-wasm     WebAssembly bindings of musette-core (web)
  musette-ffi      UniFFI bindings of musette-core (iOS, Android)
  musette-cli      the command line: talk to devices from a PC (protocol tests, captures, sync)
app/               Expo (React Native) app: web, Android, iOS from one code base
  modules/musette-native   React Native module around musette-ffi (generated)
docs/              architecture and driver notes
```

See [docs/architecture.md](docs/architecture.md).

## Develop

Requirements: Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` at the version of `Cargo.lock`, Node 22.

```sh
cargo test --workspace          # core logic
cd app
npm install
npm run wasm                    # build the Rust core for the web (src/lib/core/wasm)
npm test                        # app logic against a simulated CC600
npm run web                     # http://localhost:8081 (Web Bluetooth works on localhost)
```

Android (needs JDK 17, the Android SDK and NDK, `cargo-ndk`, the Rust targets `aarch64-linux-android` and `x86_64-linux-android`):

```sh
cd app
npm --prefix modules/musette-native run generate:android   # Rust core for Android
npm run android                 # builds, installs and starts the app (device or emulator)
```

iOS needs macOS and Xcode (`generate:ios`, then `npm run ios`), or an EAS cloud build.

Every push to `main` is built by CI and deployed to GitHub Pages.

## License

MIT — see [LICENSE](LICENSE). The OpenCC600 firmware is GPL-3.0; it talks to Musette over a protocol and shares only the MIT crates `protocol-cc600`, `route-cc600` and `settings-cc600` (it pins them by git revision), which must never contain code derived from GPL sources.
