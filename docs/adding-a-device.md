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

- Frame encode/decode. A decoder must accept a partial buffer: BLE notifications cut frames anywhere.
- Op codes and UUIDs as constants, in one place (`ble.rs`). Nothing copies them: the app gets the UUIDs from the session (`Session::channels`).
- A **session**, as `driver_bryton::ble::Session` and `driver_cc600::Session`: one method per request returns what to write, `on_<channel>(bytes)` returns the writes that follow and the events (a ride, progress, a failure). Multi-step flows (chunked download, file upload, retries) are decided here, not in TS. If silence means something (a lost ack), the session has an `on_silence()` and says what it waits for.
- If we write the firmware, a device in memory (`driver_cc600::sim`) to test the session against.

Tests: decode the frames of a real capture (hex fixtures in `tests/` or in the test module), check that `encode` gives the same bytes back, and run each request to its end (see `crates/driver-cc600/src/tests.rs`).

## 3. Rust: the device model

In `crates/device/src/lib.rs`:

- Add the model to `Model` with its `id()` (the app's name for it), `display_name()` and `capabilities()`. A new transport for a known model changes `Transports` (`ble: true`) and the capability flags, and `capabilities_over(link)` if a link does less. It does not add a new model. The app reads the capabilities from here: nothing to copy.
- Keep the flags `false` until the feature has been tested on a real device. Add a comment that says what is still to be confirmed.

## 4. Rust: the model in the session (`musette-core`)

The app knows one session for every model, `musette_core::Session` (`crates/musette-core/src/session.rs`): `connect`, `list_activities`, `download`, `acknowledge`, `send_route`, `send_file`, `read_settings`, `write_settings`, then `on_notify(channel, bytes)` and `on_timeout()`. Each returns a `Step`: channels to subscribe, writes, progress, how long to wait, and the `Outcome` that ends the request. To add a model:

- An `Inner` variant around the driver's session, and its arm in each method. Requests the device cannot do return an `Error` (the UI does not offer them: `capabilities`).
- Its `channels()`: the GATT characteristics, in the order of the channel numbers the driver uses.
- Its `Timing`: how long it may stay silent (`request_ms`), and `short_ms` where silence means something.
- Map the driver's events to the generic outcomes: rides as `Activity` (stable `id`, `start_time`, `local_time` when the device counts in its own wall clock), a ride as `File` **after** `verify_fit` (the `checked` helper), settings as `SettingField`s and `Setting`s (`setting_fields(model)` too), failures as `Failure` codes. A new code needs its French words in `bleDevice.ts`.

The bindings do not change: `musette-wasm` and `musette-ffi` already carry the session, and the app's `Core` (`app/src/lib/core/`) with them. Only a new kind of value (a new `Outcome`) needs both bindings and both loaders (`wasm.ts`, `load.native.ts`). After a change in Rust, in `app/`: `npm run wasm` (web), and `npm --prefix modules/musette-native run generate:android` (mobile). Commit `modules/musette-native/src`: CI regenerates it and fails if it changed.

## 5. Transport

The transport moves bytes, nothing else. Bluetooth devices all use `GattTransport` (`app/src/lib/transport/types.ts`): subscribe to and write each characteristic the session names. Its `BleOptions` has the advertised `serviceUuid` (what a search looks for), the `namePrefix`, and the other `services` the session uses (the browser must know them in advance; `registry.test.ts` checks they cover the session's channels).

- If the device needs more (read operations, a larger MTU), extend `GattTransport`, `WebGattTransport` (web) and `BlePlxGattTransport` (iOS, Android). Do not call `navigator.bluetooth` or react-native-ble-plx elsewhere: each platform gives its transports (`platform.web.ts`, `platform.ts`).
- A device that mounts as a drive uses `FileTransport` (as `BrytonUsbDevice`).

## 6. TypeScript: words, not protocol

A Bluetooth model needs no class: `BleDevice` (`app/src/lib/devices/bleDevice.ts`) runs any session. It moves the bytes, arms the timer the session asks for, and words the failures in French. What a model adds is a `BleModel` (as `BRYTON` in `brytonBle.ts`):

- `id` (add it to `ModelId` in `core/types.ts`, which copies `crates/device`) and a `name` shown when the device does not give one.
- `presentSettings(fields, values)`: French labels and Musette groups (section 8).
- `settingLabel(key)`: the setting's name in messages ("Le compteur a refusé le réglage « … »").

Then add an entry to `MODELS` in `app/src/lib/devices/registry.ts`: `label` and a French `connectHint`, then one of:

- a Bluetooth device: `ble: { options: BRYTON_BLE, model: BRYTON }`. The user does not pick the model: one search lists every Bluetooth model around, and the profile a device matches (`namePrefix`, then `serviceUuid`) tells which model it is. Make the name prefix specific, or two models will claim the same device.
- any other device (USB…): a class that implements `Device` (as `BrytonUsbDevice`), and `create` that returns `undefined` when the platform does not have the transport (`t.usbFiles ? new BrytonUsbDevice(t.usbFiles()) : undefined`). The connect screen then shows `platform.unsupported` for that platform.

Ride ids must be stable: rides are stored under `${device.model}:${ref.id}` (`app/src/lib/sync.ts`). If the BLE id of a ride is not the same as its USB id (file path), a ride copied over USB is imported again over BLE. Make the two ids the same (for example, the file name in both cases), or write down the duplicate in the driver notes. `syncActivities` acknowledges a ride only after it is verified and stored: never acknowledge or delete a ride anywhere else.

## 7. Routes (later step)

`uploadRoute(route: ParsedRoute, onProgress)` gets a device-neutral route (name, points). The driver converts it to the device's format **in Rust**, then sends it:

- CC600: `route_cc600::build` then the resumable transfer.
- Bryton: its own plan-trip FIT messages (`driver_bryton::route`), then its name. A generic FIT course writer would go in `crates/fit`, for all FIT drivers.

Set `capabilities.uploadRoute` to `true` only after the device has shown a route sent by Musette.

## 8. Settings (later step)

`readSettings()` returns `DeviceSettings`: values, and one `SettingField` for each setting (toggle, number with range and unit, choice, text, read-only). Put each field in one of Musette's groups (`SETTING_GROUPS` in `app/src/lib/settings.ts`). Do not add a group for one device. `writeSettings(changes)` gets only the changed values and must apply all of them or none.

Keys, kinds, ranges, choices and which settings can be written come from Rust (`SettingField`); the values as `Setting` (`number` for bools and numbers, `text` for choices and texts). The French labels and the groups go in a TS table (as `cc600Settings.ts`). Add a test that checks that every key has a label and a known group (see `cc600Settings.test.ts`).

## 9. App tests with a fake device

Write `app/src/test/fake<Brand>.ts`: a `GattTransport` that answers like the device.

- Cut the answers into small notifications (20 bytes) and send them asynchronously, as a real GATT link does (see `FakeCc600`).
- For a closed firmware, answer with frames rebuilt from captures (as `FakeBryton`). For a firmware we write, run the simulated device of the Rust core (as `FakeCc600` runs `driver_cc600::sim`).
- Record what the app sends (`acked`, bytes received...) and **check the bytes sent**, not only the result. A protocol that downloads a ride twice still gives the right file.
- Test the cases that lose rides: link cut during a download, corrupted FIT (the ride must not be acknowledged), a ride already stored (it must not be downloaded again).

Add the fake to `SIMULATED` in `registry.ts` if it is useful to try the app without the device.

## 10. Before you commit

- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- In `app/`: `npm run wasm && npm run check && npm test && npm run build`
- Update `docs/drivers/<brand>.md` (what is confirmed, what is still to test) and the layer diagram and roadmap in `docs/architecture.md`.

## Checklist

- [ ] Driver notes in `docs/drivers/<brand>.md`
- [ ] Sans-IO Rust session + tests on captured frames
- [ ] `Model`, its id and capabilities in `crates/device`
- [ ] The model in `musette_core::Session`: channels, timing, outcomes, settings fields
- [ ] Transport fits, or is extended in `app/src/lib/transport/`
- [ ] `BleModel` (words) in `app/src/lib/devices/`, search profile in `MODELS`, `ModelId` updated
- [ ] Stable ride ids (same ride, same id, on every transport)
- [ ] FIT verified before return; acknowledgement only from `syncActivities`
- [ ] Fake device + tests on the bytes sent
- [ ] Capabilities turned on only after a test on a real device
