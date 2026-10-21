# Bryton (stock firmware)

Target: **Bryton Rider 750**, keeping Bryton's firmware.

## Known

- Over USB the device mounts as a drive named **"Bryton"** (user manual). Rides can be copied as FIT files.
- Map packages live in `Bryton/MAP/Update` (user manual).
- Routes are normally sent by the Bryton Active app (also synced from Komoot, Strava, RideWithGPS). The manual describes no USB route copy.

## USB layout (Rider 750, OS R089, seen on 2026-10-21)

The drive label is `BRYTON` (USB id `0483:5720`, STM32 mass storage). At the root:

| Path | Content |
| --- | --- |
| `Activities/yyMMddHHmmss.fit` | Rides, standard FIT (manufacturer 267 = Bryton, product 1902). The name is the start time in **local time**: `260922125127.fit` starts at 10:51:27 UTC (UTC+2). There is also a `tmp.fit`: skip it. |
| `System/History/Summary/yyMMddHHmmss.sum` | One per ride, same name. A small FIT file (469 bytes) with the ride summary. |
| `PlanTrip/<name>.fit` | Routes, in Bryton's own FIT messages (see [bryton-ble.md §6](bryton-ble.md#6-route-fit-file-type-11)), not a FIT course. |
| `Tracks/<name>/` | Per route: `<name>.zinfo` (16 B), `dupli.track` and `dupli2.track` (one 16-byte record per route point: lat i32 LE ×1e6, lon i32 LE ×1e6, altitude u16 LE in m, 6 zero bytes), `sort1.path`, `sort2.path`. **[open]** whether the device builds them from the FIT, or they are the app's `.dat` (BLE file type 23). |
| `System/*.ini`, `System/device.txt` | Settings, profiles. `device.txt` has the versions, a `UUID` and `[CAP] COM="201"`. `DeviceData.ini` has `Alt_P0` and the altitude calibration. |
| `MAP/` | Map tiles and `MapData/<country>`: most of the 15 GB. |
| `Debug/*.log` | Device logs. |

`driver-bryton::find_activities` should use `Activities/*.fit`, without `tmp.fit`.

## To do on a real device

1. ~~Folder layout~~: done, see above.
2. **Route copy** — copy a route FIT written by Musette (Bryton messages) to `PlanTrip/`, unplug, and check that the device lists it. Also check whether the device needs `Tracks/<name>/`.
3. **Bluetooth** (later) — the protocol, read from the Android app, and the tests to run: [bryton-ble.md](bryton-ble.md). Capture Bryton Active traffic with Android's *Bluetooth HCI snoop log* and Wireshark; inspect the app with jadx for GATT UUIDs and message formats. Reverse engineering for interoperability is allowed in the EU (Directive 2009/24/EC art. 6; France CPI L122-6-1) within its limits: do not redistribute Bryton code.
