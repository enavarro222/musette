# Bryton (stock firmware)

Target: **Bryton Rider 750**, keeping Bryton's firmware.

## Known

- Over USB the device mounts as a drive named **"Bryton"** (user manual). Rides can be copied as FIT files.
- Map packages live in `Bryton/MAP/Update` (user manual).
- Routes are normally sent by the Bryton Active app (also synced from Komoot, Strava, RideWithGPS). The manual describes no USB route copy.

## To do on a real device

1. **Folder layout** — mount the drive and save a listing (`tree /path/to/Bryton > listing.txt`). Tighten `driver-bryton::find_activities` with the real folder names (they are guesses today).
2. **Route copy** — send a route with Bryton Active, mount the drive, find the new file (folder, extension, format). If it is a FIT course or GPX, write the same file from Musette and check the device lists it after unplugging.
3. **Bluetooth** (later) — capture Bryton Active traffic with Android's *Bluetooth HCI snoop log* and Wireshark; inspect the app with jadx for GATT UUIDs and message formats. Reverse engineering for interoperability is allowed in the EU (Directive 2009/24/EC art. 6; France CPI L122-6-1) within its limits: do not redistribute Bryton code.
