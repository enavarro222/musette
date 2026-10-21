# Notes for contributors (and coding agents)

- Rust core in `crates/`, app in `app/` (Expo: web, Android and iOS from one code base). Read `docs/architecture.md` first.
- `crates/protocol-cc600`, `route-cc600` and `settings-cc600` are shared with the GPL firmware (OpenCC600): keep them MIT and `no_std` (`route-cc600` allocates only behind its `build` feature). The firmware depends on them by git; they are the only copy of these formats. Never copy code from c606-oss or other GPL sources into this repo.
- The app reaches Rust only through `app/src/lib/core` (`Core`). Logic goes in `crates/musette-core`; `musette-wasm` (web) and `musette-ffi` (iOS, Android) only convert types. A new function goes in all three, plus both loaders (`load.ts`, `load.native.ts`), then regenerate the native module (`npm --prefix app/modules/musette-native run generate:android`) and commit its `src/`.
- Keep op codes and BLE UUIDs in sync between `crates/protocol-cc600` and `app/src/lib/devices/cc600.ts`.
- Never acknowledge or delete a ride on a device before it is verified and stored (`app/src/lib/sync.ts`).
- UI: `@expo/ui` universal components (SwiftUI on iOS, Compose on Android, DOM on the web). Platform differences go in `.web.ts(x)` / `.native.ts` files, not in `if (Platform.OS)` spread through screens.
- Before committing: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and in `app/`: `npm run wasm && npm run check && npm test && npm run build`.
- App tests (vitest) run the app logic against `src/test/fakeCc600.ts`, a simulated CC600 whose file transfers go through the real device-side Rust code (`Cc600Receiver`). Check bytes sent, not only the result: a wasteful protocol still delivers the right file.
- Heavy builds (Gradle, NDK, emulator) can freeze a laptop: limit them (CPU pinning and a memory cap), and do not run the emulator during a build.
- UI strings are French for now.
