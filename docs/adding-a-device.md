# Adding a device

How to add a new bike computer or watch to Musette, or a new way to talk to one
(for example the Bryton Rider 750 over Bluetooth, next to its USB driver). Read
[architecture.md](architecture.md) first.

The running example is **Bryton over BLE**. Replace the names for another device.

## 0. Know the device before writing code

Write what you know in `docs/drivers/<brand>.md` (see [drivers/bryton.md](drivers/bryton.md)). Answer these questions first:

| Question | Bryton BLE example |
| --- | --- |
| Transport | BLE GATT: which service, which characteristics (write, notify, read)? |
| Ride list | How does the device list rides? Which id is stable? Is there a start time and a size? |
| Ride download | Is it a FIT file? Is it sent in chunks? Is there a checksum? |
| Ride acknowledgement | Can the app mark a ride as copied? Does the device delete it after that? |
| Route | Which format (FIT course, GPX, own format)? Is the route sent as a file or as messages? |
| Settings | Can the app read them and write them? |

For a closed protocol, capture the official app's traffic (Android *Bluetooth HCI snoop log* + Wireshark) and inspect the app (jadx) only for UUIDs and message layouts. Reverse engineering for interoperability is allowed in the EU within its limits. **Never copy code** from the official app, from c606-oss or from any GPL source.

Captures are useful as test fixtures, but they contain your GPS positions (your home is where rides start). Remove them, or move the points, before you commit a capture.

## 1. Choose the smallest first step

Start with **ride download only**. This is the feature that users need most, and it is the one where errors are not acceptable. Add routes and settings in later commits. The UI shows only what `capabilities` turns on, so a partial driver is a valid driver.

## 2. Rust: the protocol (sans-IO)

Rust code encodes requests, decodes responses and decides what comes next. It does no I/O. The host (web or mobile) owns the transport.

Where to put it:

- **Same brand, new transport** → a module in the existing driver crate: `crates/driver-bryton/src/ble.rs`. Keep the USB code in `lib.rs` or move it to `usb.rs`.
- **New brand** → a new crate `crates/driver-<brand>`. Add it to `members` and `[workspace.dependencies]` in the root `Cargo.toml`.
- **A format the firmware also uses** (only for devices whose firmware we write, as the CC600) → a separate MIT `no_std` crate, as `protocol-cc600`.

What the module contains:

- Frame encode/decode (`encode(op, seq, payload) -> Vec<u8>`, `decode(&[u8]) -> Result<(Frame, consumed), Error>`). A decoder must accept a partial buffer: BLE notifications cut frames anywhere.
- Op codes and UUIDs as constants, in one place (`ble.rs`), with a comment that names the TS file that copies them.
- Decoders for each response (ride entry, chunk, device info) to plain structs.
- State machines for multi-step flows (chunked download, file upload), as `protocol_cc600::transfer::Sender`: the host gives it the received payloads and asks it what to send next.

Tests: decode the frames of a real capture (hex fixtures in `tests/` or in the test module), and check that `encode` gives the same bytes back.

## 3. Rust: the device model

In `crates/device/src/lib.rs`:

- Add the model to `Model` with its `display_name()` and `capabilities()`. A new transport for a known model changes `Transports` (`ble: true`) and the capability flags. It does not add a new model.
- Keep the flags `false` until the feature has been tested on a real device. Add a comment that says what is still to be confirmed.

## 4. Bindings (WASM and UniFFI)

The app reaches Rust through one interface, `Core` (`app/src/lib/core/types.ts`), the same on every platform. For each thing TS needs:

1. **`crates/musette-core`**: a plain Rust function (or struct) that calls the driver crate. Name it `<brand>_<thing>` (`bryton_ble_encode`, `BrytonDownload`). Errors are `musette_core::Error` with a message the app can show or map. All logic goes here.
2. **`crates/musette-wasm`** (web): a `#[wasm_bindgen]` wrapper, camelCase name (`brytonBleEncode`). Return structs with `serde_wasm_bindgen::to_value`, errors as `JsError`.
3. **`crates/musette-ffi`** (iOS, Android): a `#[uniffi::export]` wrapper, snake_case name (the generated TS is camelCase). Return `uniffi::Record`s, errors as `FfiError`.
4. **`Core`**: add the function to `types.ts`, then to both loaders: `wasm.ts` (web) and `load.native.ts` (mobile). They only convert types (`Uint8Array` ↔ `ArrayBuffer`, `null` → `undefined`, `bigint` → `number`).

Add the driver crate to `crates/musette-core/Cargo.toml`. Then, in `app/`: `npm run wasm` (web), and `npm --prefix modules/musette-native run generate:android` (mobile). Commit `modules/musette-native/src`: CI regenerates it and fails if it changed.

## 5. Transport

The transport moves bytes, nothing else.

- `PacketTransport` + `WebBluetoothTransport` fit a device with **one write characteristic and one notify characteristic**. Give them a `BleOptions` (`serviceUuid`, `rxUuid`, `txUuid`, `namePrefix`).
- If the device needs more (several notify characteristics, read operations, a larger MTU), extend `BleOptions`, `WebBluetoothTransport` (web) and `BlePlxTransport` (iOS, Android) in `app/src/lib/transport/`. Do not call `navigator.bluetooth` or react-native-ble-plx from the driver: each platform gives its transports (`platform.web.ts`, `platform.ts`), and the driver must work with all of them.
- A device that mounts as a drive uses `FileTransport` (as `BrytonUsbDevice`).

## 6. TypeScript: the driver

Create `app/src/lib/devices/brytonBle.ts` with a class that implements `Device` (`app/src/lib/devices/types.ts`). Use `Cc600Device` (BLE) and `BrytonUsbDevice` (USB) as models.

- Copy the UUIDs and op codes from the Rust constants, with a `/** Keep in sync with crates/... */` comment.
- `capabilities` must be the same as `Model::capabilities()` in Rust.
- `connect()`: connect the transport, subscribe to data, do the handshake.
- `listActivities()`: return `ActivityRef`s with a **stable `id`**. Rides are stored under `${device.model}:${ref.id}` (`app/src/lib/sync.ts`). If the BLE id of a ride is not the same as its USB id (file path), a ride copied over USB is imported again over BLE. Make the two ids the same (for example, the file name in both cases), or write down the duplicate in the driver notes.
- `downloadActivity()`: return the FIT bytes **after** `verifyFit` (from `loadCore()`). Report progress with `onProgress(ratio)`.
- `acknowledgeActivity()`: implement it only if the device supports it. `syncActivities` calls it only after the ride is verified and stored. Never acknowledge or delete a ride anywhere else.
- Put each request in a timeout (`requestMs`, as `Cc600Timing`), so that the UI does not wait forever when the link drops. Make the timeouts a constructor parameter, so tests can make them short.
- Error messages are shown to the user: write them in French.

Then:

- Add the model id to `ModelId` in `types.ts` (it copies `crates/device`), if it is a new model.
- Add an entry to `MODELS` in `app/src/lib/devices/registry.ts`: `label` and a French `connectHint`, then one of:
  - a Bluetooth device: `ble: { options: BRYTON_BLE, open: (t) => new BrytonBleDevice(t) }`. The user does not pick the model: one search lists every Bluetooth model around, and the profile a device matches (`namePrefix`, then `serviceUuid`) tells which model it is. Make the name prefix specific, or two models will claim the same device.
  - any other device (USB…): `create` that returns `undefined` when the platform does not have the transport (`t.usbFiles ? new BrytonUsbDevice(t.usbFiles()) : undefined`). The connect screen then shows `platform.unsupported` for that platform.

## 7. Routes (later step)

`uploadRoute(route: ParsedRoute, onProgress)` gets a device-neutral route (name, points). The driver converts it to the device's format **in Rust**, then sends it:

- CC600: `cc600BuildRoute` (route-cc600) then the resumable transfer.
- Bryton and most stock firmwares: a FIT course. There is **no FIT course writer yet** in `crates/fit`. Add one there (all FIT drivers will use it), not in the driver crate.

Set `capabilities.uploadRoute` to `true` only after the device has shown a route sent by Musette.

## 8. Settings (later step)

`readSettings()` returns `DeviceSettings`: values, and one `SettingField` for each setting (toggle, number with range and unit, choice, text, read-only). Put each field in one of Musette's groups (`SETTING_GROUPS` in `app/src/lib/settings.ts`). Do not add a group for one device. `writeSettings(changes)` gets only the changed values and must apply all of them or none.

The ranges and choices come from Rust when we know them. The French labels and the groups go in a TS table (as `cc600Settings.ts`). Add a test that checks that every key has a label and a known group (see `cc600Settings.test.ts`).

## 9. App tests with a fake device

Write `app/src/test/fake<Brand>.ts`: a class that implements the same transport as the device (`PacketTransport` here) and answers like the device.

- Cut the answers into small notifications (20 bytes) and send them asynchronously, as a real GATT link does (see `FakeCc600`).
- For a closed firmware, answer with frames rebuilt from captures. For a firmware we write, run the device-side Rust code (as `FakeCc600` runs `Cc600Receiver`).
- Record what the app sends (`acked`, bytes received...) and **check the bytes sent**, not only the result. A protocol that downloads a ride twice still gives the right file.
- Test the cases that lose rides: link cut during a download, corrupted FIT (the ride must not be acknowledged), a ride already stored (it must not be downloaded again).

Add the fake to `SIMULATED` in `registry.ts` if it is useful to try the app without the device.

## 10. Before you commit

- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- In `app/`: `npm run wasm && npm run check && npm test && npm run build`
- Update `docs/drivers/<brand>.md` (what is confirmed, what is still to test) and the layer diagram and roadmap in `docs/architecture.md`.

## Checklist

- [ ] Driver notes in `docs/drivers/<brand>.md`
- [ ] Sans-IO Rust module + tests on captured frames
- [ ] `Model` and capabilities in `crates/device`
- [ ] Logic in `musette-core`, bindings in `musette-wasm` and `musette-ffi`, `Core` and both loaders
- [ ] Transport fits, or is extended in `app/src/lib/transport/`
- [ ] `Device` class in `app/src/lib/devices/`, UUIDs and op codes in sync with Rust
- [ ] Stable ride ids (same ride, same id, on every transport)
- [ ] FIT verified before return; acknowledgement only from `syncActivities`
- [ ] Entry in `MODELS`, `ModelId` updated
- [ ] Fake device + tests on the bytes sent
- [ ] Capabilities turned on only after a test on a real device
