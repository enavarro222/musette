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

## Many devices

Musette aims at as many bike computers and watches as possible. Everything above the drivers is device-neutral:

- **Routes**: the app prepares one route (name, points, climbs); `Device.uploadRoute` writes it in the device's format (OCRT for the CC600, a FIT course for others).
- **Settings**: `Device.readSettings` returns the values and their description (`SettingField`: toggle, number with range and unit, choice, text, read-only). Each setting is filed in one of **Musette's groups** (`SETTING_GROUPS` in `web/src/lib/settings.ts`: Affichage, Sortie, Navigation, Capteurs, Sons, Énergie, Système), so the settings screen is organised the same for every device and knows none of them. `writeSettings` gets only the changed values.
- **Rides**: FIT, the common format, checked before they are acknowledged.

For the CC600, keys, ranges and choices come from `settings-cc600` (`FIELDS`, checked against what the device accepts); the driver adds labels and groups (`cc600Settings.ts`, a test checks every key has them).

## CC600 protocol (draft)

Defined in `crates/protocol-cc600`. Frame: `ver | op | seq | len (u16 LE) | payload | crc16`. Requests (`op < 0x80`) come from the app; responses reuse the request's `seq`. BLE: one service, an RX characteristic (write without response) and a TX characteristic (notify); frames may span several GATT packets.

Main flows:

- `Hello` → `DeviceInfo`
- `ListActivities` → `ActivityEntry`* → `EndOfList`
- `GetSettings` → `Settings` (the settings file, `key=value` lines); `SetSettings` (changed lines only) → `Ok` or `Error(BadSetting, key)`, all or nothing
- `ReadActivity(id, offset, max)` → `ActivityChunk` (repeat) → app verifies → `AckActivity`
- `TransferBegin(kind, size, crc)` → `TransferReady(next, window)` → `TransferChunk`* (⇄ `TransferAck`) → `TransferEnd` → `Ok` (replaces the active route, or the map of the route). Kinds: route, map.

### File transfer (`protocol_cc600::transfer`)

Routes and maps are a few hundred KB over BLE (5–20 KB/s from a browser), so the transfer is **resumable** and **flow-controlled**:

- The device keeps the partial file and its running CRC. A new `TransferBegin` with the same kind, size and CRC answers `TransferReady` with `next > 0`: the app continues from there.
- The app pipelines chunks (write without response) up to `window` bytes; the device acks every `window/2` bytes and at the end.
- A chunk that is not the expected one is not written; the device sends one `TransferResend(next)` and the app resends from there. `TransferAck` only means progress: with chunks in flight it is always behind what the app sent.
- Silence (lost ack or lost last chunk): the app sends `TransferBegin` again and the device says where it is.
- `TransferEnd` checks size and the CRC of the whole file, then commits atomically. `BadCrc` drops the partial file.
- Errors (`Op::Error`, one byte): bad request, no space, no transfer, incomplete, bad CRC, busy (ride recording), storage.
- `Receiver` (device) and `Sender` (app) are sans-IO state machines, tested together with lost chunks and cuts.

## Roadmap

- [ ] CC600: route upload (prepared route: simplified track + climbs + map corridor)
- [ ] CC600: settings and sensors screens
- [ ] Map view (MapLibre) with corridor preview
- [ ] Bryton: confirm folder layout, test route copy over USB (see `drivers/bryton.md`)
- [ ] Decode FIT sessions (distance, duration) with `fitparser` for richer ride lists
- [ ] Service worker for offline use; Web Share Target on Android
- [ ] i18n (UI is French for now)
