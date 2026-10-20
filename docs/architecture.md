# Architecture

## Principles

1. **Rides are never lost.** A ride is acknowledged to the device only after it has been downloaded, verified (`fit::verify`: header + CRC) and stored. Order: download → verify → store → acknowledge.
2. **Local first.** No account, no server. Activities live in the browser (IndexedDB) and are exported as FIT files.
3. **One app, many devices.** The UI shows only what the connected device can do (`Capabilities`).
4. **Explicit actions.** Destructive or irreversible actions (replacing the device's route, deleting a ride) are always confirmed.

## Layers

```
┌──────────────── web/ (React) ─────────────────┐
│ screens: Compteur · Sorties · Traces · Projet │
│ lib/devices: Cc600Device, BrytonUsbDevice      │  device logic in TS,
│ lib/transport: PacketTransport | FileTransport │  bytes ↔ meaning in Rust
└───────────────┬───────────────────────────────┘
                │ wasm-bindgen (musette-wasm)
┌───────────────▼──────── crates/ ──────────────┐
│ protocol-cc600 · fit · track · climbs ·        │
│ device · driver-bryton                         │
└────────────────────────────────────────────────┘
```

**Drivers are sans-IO.** Rust code encodes/decodes and decides; the host owns the I/O. This keeps the core testable and reusable: the same `protocol-cc600` crate builds into the firmware (`no_std`), the browser (WASM) and any future native host.

**Transports** (`web/src/lib/transport/types.ts`):

- `PacketTransport` — message link. Web: `WebBluetoothTransport` (GATT write + notify).
- `FileTransport` — device mounted as a drive. Web: `FileSystemAccessTransport`.

A host can inject other implementations through `MusettePlatform` (`mountMusette(target, platform)` in `src/main.tsx`).

## CC600 protocol (draft)

Defined in `crates/protocol-cc600`. Frame: `ver | op | seq | len (u16 LE) | payload | crc16`. Requests (`op < 0x80`) come from the app; responses reuse the request's `seq`. BLE: one service, an RX characteristic (write without response) and a TX characteristic (notify); frames may span several GATT packets.

Main flows:

- `Hello` → `DeviceInfo`
- `ListActivities` → `ActivityEntry`* → `EndOfList`
- `ReadActivity(id, offset, max)` → `ActivityChunk` (repeat) → app verifies → `AckActivity`
- `RouteBegin` → `RouteChunk`* → `RouteCommit` (replaces the active route)

## Roadmap

- [ ] CC600: route upload (prepared route: simplified track + climbs + map corridor)
- [ ] CC600: settings and sensors screens
- [ ] Map view (MapLibre) with corridor preview
- [ ] Bryton: confirm folder layout, test route copy over USB (see `drivers/bryton.md`)
- [ ] Decode FIT sessions (distance, duration) with `fitparser` for richer ride lists
- [ ] Service worker for offline use; Web Share Target on Android
- [ ] i18n (UI is French for now)
