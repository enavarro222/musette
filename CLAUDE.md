# Notes for contributors (and coding agents)

- Rust core in `crates/`, web app in `web/`. Read `docs/architecture.md` first.
- `crates/protocol-cc600`, `route-cc600` and `settings-cc600` are shared with the GPL firmware (OpenCC600): keep them MIT and `no_std` (`route-cc600` allocates only behind its `build` feature). The firmware depends on them by git; they are the only copy of these formats. Never copy code from c606-oss or other GPL sources into this repo.
- Keep op codes and BLE UUIDs in sync between `crates/protocol-cc600` and `web/src/lib/devices/cc600.ts`.
- Never acknowledge or delete a ride on a device before it is verified and stored (`web/src/lib/sync.ts`).
- Before committing: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and in `web/`: `npm run wasm && npm run check && npm test && npm run build`.
- Web tests (vitest) run the app against `src/test/fakeCc600.ts`, a simulated CC600 whose file transfers go through the real device-side Rust code (`Cc600Receiver`). Check bytes sent, not only the result: a wasteful protocol still delivers the right file.
- UI strings are French for now.
