# Bryton over Bluetooth (stock firmware)

The BLE protocol that the Bryton Active app uses with Rider computers. Target: **Rider 750**. Other models are listed at the end.

**Status: read from the app, then partly checked on a Rider 750 on 2026-10-21 (see §0, which wins over the rest of this page).** Each fact has a confidence tag:

- **[app]**: read in the decompiled app and clear.
- **[guess]**: a guess from the code: names, unused values or code that jadx did not decompile well.
- **[open]**: unknown. Test it on a device before writing code that depends on it.
- **[usb]**: seen in the Rider 750's files over USB (see [bryton.md](bryton.md#usb-layout-rider-750-os-r089-seen-on-2026-10-21)).
- **[dev]**: seen on a Rider 750 over BLE (OS R089, BLE v03), with `musette` (`crates/musette-cli`) from a Linux PC (BlueZ).

The "Tests on a real device" section lists what to check first.

## 0. Confirmed on a Rider 750 (2026-10-21)

Run: `musette scan | gatt | sniff | info | list | download` (see `crates/musette-cli`). Traces are kept outside the repo (they hold GPS positions).

**Link**
- Advertised name **`Rider750`**, advertised service **`0x2014`** (16-bit). Use it, or the name, for the Web Bluetooth filter.
- GATT exactly as in §1. Command and setting characteristics: `WRITE | NOTIFY`. Data: `WRITE_WITHOUT_RESPONSE | WRITE | NOTIFY`. Notify: `WRITE | NOTIFY`.
- **No bonding needed.** The negotiated MTU was **153** (BlueZ, without asking).
- Subscribing to everything and sending nothing: the device sends nothing.

**Connection sequence that works** (one command at a time):

```
> command  06 04                    read device info
< command  06 24 02                 OK
> command  06 44 03                 action 3 (success): needed, else no data
< data     start, 4 frames, end     UD / IV / MN / CP strings
  (subscribe to the setting channel)
> setting  2f 01 00 30              cmd 47 "set new app": this triggers the handshake
< setting  2f 0a                    ack
< setting  34 01 48 f4 01 00 00 50 96 00 00 00 57 01 b0
                                    handshake v1: H=500 frames per batch, P=150, W=1
> setting  34 0a                    ack
> command  0b 08 00                 file list, type 0 (unsynced)
< command  0b 28 02                 OK
> command  0b 48 03                 action 3: needed, else no data (action 5 does not work)
< data     start (N=20, count=10), 20 frames, end
> command  11 08 <id> 01 00000000 00000004    size
< command  11 28 02
> command  11 48 05 01 f4           action 5, batch 500
< data     1 frame: size u32 BE + 14 more bytes
> command  11 0c <id> 01 00000000 00009ab0    range 0, 39 600 bytes
...                                 268 frames of 150 bytes, no "continue" needed (batch 500)
```

- **Device info**: `IV089.013.0005.03.011.001`, `MNRider750`, `CPAFF,0` (file ranges, workout, plan trip, setting, firmware update, altitude, Wi-Fi, fast BT, command versions, valid). The start frame's byte 6 is 0, not the seq.
- **Frame size**: the device info and the ride list come in **20-byte frames** even after the handshake (P=150). File ranges come in 150-byte frames. The receiver must not assume one frame size.
- **Ride list**: entries as in §3.4. The start frame has the count in bytes 7-8. Checked against the USB files:
  - `fileId` formatted as UTC = the USB file name (`260922125127`). **Same id over USB and BLE.**
  - `activity_time` = timer time in **seconds**. `activity_dist` = **metres**. `sport_type` 2 = cycling (FIT sport 2).
  - Byte 0 = 19 (`0x13`) for every entry: probably the number of used bytes. Bytes 19-35 are zero.
  - List type 0 gave the 10 rides of 2026, not the 18 rides of 2025 that are still on the drive (synced earlier by the app). List type 11 ("all") gave the same 10: **[open]** whether this firmware ignores the type.
- **Ride download**: the reply to "offset 0, length 4" is one 18-byte frame. The first 4 bytes are the file size (u32 BE). The rest looks like bytes 4-17 of the file, so ignore it. The full ride (64 339 bytes, 2 ranges) was **byte-for-byte identical** to the USB file. Speed is about 8 KB/s.
- **Downloading does not mark the ride as synced**: it is still in list type 0 afterwards.
- **Acknowledgement = setting cmd 51 "set btnotifydev"**: `[0x33, 0x01, fileId u32 LE, checksum]`, for example `33 01 cf 79 b2 6a 98`. The device acks `33 0a`, and the ride leaves list type 0 (10 → 9 rides). The app sends it right after it stores a synced ride (`BleService.processGetFileRangeReturn`), but not for a "file management export". This is `acknowledgeActivity()`. **[open]** Whether the file stays on the drive (check over USB). List types 10 and 11 also gave the 9 rides, so this firmware seems to list only unsynced rides.
- **No BLE command deletes a ride.** The app's "delete files" screen deletes its own local copies only. The `del_dev_files` feature flag has no command behind it in this app version. Over USB, the files can be deleted (`Activities/<name>.fit` and `System/History/Summary/<name>.sum`). **[open]** whether the device handles that cleanly.
- **The device pushes setting frames on its own** once the setting channel is on. The app acks each one with `[cmd, 0x0a]`:
  - cmd 24 (battery) every 5 s: `18 01 00 03 01 1d`. Payload `00 03 01` **[open]**: maybe a level (3 bars?) and a charging flag. Compare with the screen.
  - cmd 39 (device notify) every 20 s: `27 01 00 00 00 28`.

  A host timeout must count only command and data frames.

Source: Bryton Active for Android, China build `com.brytonsport.barringercn` 3.0.39 (version code 385), from download.brytonsport.com, decompiled with jadx 1.5.1. Code: `com.brytonsport.active.bleplugin` (`BbcpUtil`, `DataUtil`, `ParserUtil`, `SampleGattAttributes`, `ConstSettingChannel`, `NewSettingUtil`), `utils.BleUtil` and `service.BleService`. The global build from Google Play may be different **[open]**. Class names are given only so that you can find the code again. Do not copy code from the app (see [adding-a-device.md](../adding-a-device.md)).

## 1. GATT

| Service | Characteristic | Use |
| --- | --- | --- |
| `454D7788-A122-058D-9B42-9D0F3772AF82` (command and data) | `454D2288-A122-058D-9B42-9D0F3772AF82` | **Command channel.** The app writes with response. The device notifies. |
| | `454D1188-A122-058D-9B42-9D0F3772AF82` | **Data channel.** The app writes without response if the characteristic allows it, else with response. The device notifies. |
| `454D7766-A122-058D-9B42-9D0F3772AF82` (notify) | `454D3388-A122-058D-9B42-9D0F3772AF82` | Phone notifications (call, SMS, app) sent to the device. Not needed for Musette. |
| `50B85566-C2DE-A994-094D-340090726877` (setting) | `50B81188-C2DE-A994-094D-340090726877` | **Setting channel**: settings, capabilities and the handshake. The device notifies. |

- **[app]** The app turns on notifications for the command, data and notify channels as soon as services are discovered. It turns them on for the setting channel only when the device info says that the device supports settings (CP bit 0x008, §3.2).
- **[app]** The app asks for an ATT MTU of **153**. When the MTU is set, it sends "read device info" (§3.2).
- **[open]** Web Bluetooth cannot ask for an MTU. Is the frame size that the device announces (§4.2) based on the real MTU, or is it fixed?
- **[open]** The advertised name. Web Bluetooth needs a `namePrefix` or a service UUID for its filter. Is the command service in the advertising data?
- **[open]** Does the device need bonding? The app has a "bind" path (`createBondOrConnect`) for some models.
- **[open]** These UUIDs are **not** in `nordic.bin` (the Rider 750's nRF firmware, BLE v03), in either byte order. The nRF may build them at run time, or the GATT table may be elsewhere. Check with nRF Connect.

## 2. Byte order and checksums

The two protocols do not use the same conventions:

| | Command and data channels ("BBCP") | Setting channel |
| --- | --- | --- |
| Integers | **big-endian** | **little-endian** |
| Checksum | **u32 sum** of the payload bytes, sent in an end frame | **u8 sum** (mod 256) of all the bytes before it, as the last byte of each frame |

## 3. Command channel (BBCP)

### 3.1 Frame

```
byte 0   cmd id
byte 1   control:  bits 7-5 type | bits 4-2 seq | bits 1-0 reserved (0)
byte 2.. arguments (command), status (response) or action code (action)
```

- **[app]** Types: 0 = command (app → device), 1 = response (device → app), 2 = action (both ways), 3 = reserved.
- **[app]** `seq` is 3 bits. The app adds 1 before each new command (so the first command after connection has seq 1) and wraps it at 8. An action uses the seq of the response it answers.
- **[app]** So a command byte 1 is `seq << 2`, an action is `0x40 | seq << 2`, and a response is `0x20 | seq << 2`.

**Response** (device → app): `[cmd, 0x20|seq<<2, status]`

| Status | Meaning |
| --- | --- |
| 0 | unknown error |
| 1 | busy |
| 2 | **OK** |
| 3 | factory status |
| 4 | address error |
| 5 | time sync needed |
| 6 | nothing to sync (for cmd 11, an empty list) |

**Action** (both ways): `[cmd, 0x40|seq<<2, code, ...]`

| Code | Meaning | Extra bytes |
| --- | --- | --- |
| 0 | unknown error | |
| 1 | checksum error | |
| 2 | packet lost | |
| 3 | success | |
| 4 | abort | |
| 5 | set the number of packets per batch | `flowCtrl` u16 BE |
| 6 | continue (send the next batch) | |

### 3.2 Commands

| Id | Name | Request (after `cmd, ctrl`) | Reply |
| --- | --- | --- | --- |
| 6 | read device info | none | data channel: device info (below) |
| 7 | device status | none | **[open]** |
| 8 | send the user address | 8 ASCII bytes | response only. **[open]** what "address" means here |
| 9 | update image | **[open]** | not used by the app |
| 11 | file list | none, or 1 byte list type (below) | data channel: 36-byte entries (§3.4) |
| 12 | get file | `fileId u32` + `fileType u8` | data channel: the whole file |
| 15 | request data | `requestType u8` | data channel |
| 16 | send a file to the device | `fileType u8` | upload flow (§3.6) |
| 17 | get a file range | `fileId u32` + `fileType u8` + `offset u32` + `length u32` | data channel: that range (§3.5) |
| 18 | file list for file management | **[guess]** as cmd 11 | **[open]** |

**Read device info (6)**. **[app]** The data is a list of ASCII strings separated by `0x00`. Each string starts with a 2-letter tag:

- `UD`: device id (the app stores it as `uuid`)
- `IV`: firmware version
- `MN`: model name. If it contains `s=`, the device is **recording**, and the app does not sync rides then.
- `CP`: capabilities, hex. The app parses the text before the first comma as a hex integer. Bit `0x800` means "this field is valid". Without it, all the bits below are false.

| CP bit | Meaning |
| --- | --- |
| 0x001 | `ftp`: file ranges (cmd 17) are supported. Without it, the app uses cmd 12. |
| 0x002 | workout |
| 0x004 | plan trip (routes) |
| 0x008 | setting channel |
| 0x010 | firmware update |
| 0x020 | altitude |
| 0x040 | Wi-Fi |
| 0x080 | fast BT |
| 0x100 | grid (data pages) |
| 0x200 | per-command capability versions on the setting channel (§4.1) |

- **[open]** What comes after the first comma in `CP`.

**File list types (11)**: 0 = rides not yet synced, 10 = file management, not synced, 11 = file management, all. The 2-byte form (no type) is for old firmware.

**Request data types (15)**: 0 = `System.ini`, 1 = my favourites, 2 = group track messages, 3 = live segment list, 4 = device debug file.

**File types (12, 17)**: **[app]** the app always uses `1` for rides. **[open]** Other values. The voice recording uses fileId 0 with type 1.

**`fileId` [app]**: a time in seconds since 1970. The app formats it **as UTC** to get `yyMMddHHmmss`.

- **[usb]** Over USB, the ride is `Activities/yyMMddHHmmss.fit` and the name is the start time in **local** time.
- **[guess]** So `fileId` is the local wall-clock time counted as if it were UTC. Formatting it as UTC then gives the USB file name. If this is right, use that string as the ride id on both transports, and the same ride gets the same id over USB and BLE (see `listActivities()` in adding-a-device.md). **[open]** Check that the list gives `fileId` = name parsed as UTC.

### 3.3 Data channel: transfers

Each transfer, in either direction, has the same three parts:

```
start frame  [0x00 0x00] [N u16] [lastSize u8] [cmd u8] [byte 6] [extra...]
data frame   [index u16 = 1..N] [payload]
end frame    [index u16 = N+1] [0x00] [sum u32]      (7 bytes)
```

- **[app]** `N` is the number of data frames. `lastSize` is the payload size of frame N. Every other data frame carries `frameSize - 2` bytes, where `frameSize` is `payloadSize` from the handshake (§4.2), or 20 before the handshake.
- **[app]** `sum` is the sum of all payload bytes of frames 1..N, as unsigned bytes. The 2-byte indexes are not counted.
- **[app]** The receiver orders frames by index. On a sum error, the app retries the same range (cmd 17) or reports an error (other commands).
- **[app]** The app treats a frame whose index is above N and whose length is not 7 as "empty data".
- **[guess]** Byte 6 is the control byte (seq). The app sends `seq << 2` there on upload. On download it reads byte 6 and ignores it.
- **[open]** What byte 2 of the end frame means. The app sends 0.
- **[app]** In the start frame for cmd 11, bytes 7-8 hold the number of list entries (u16 BE).
- **[open]** What extra bytes the device puts in the start frame for cmds 12 and 17.
- **[app]** `N = 0` means "nothing": an empty reply (cmd 15 gives empty data).

**Batches (flow control)** **[app]**: frames go in batches of `flowCtrl` frames (`handShakeSize` from the handshake, 10 by default). The start frame counts as index 0. After the frame whose `index % flowCtrl == flowCtrl - 1` (indexes 9, 19, 29... with 10), the sender waits until the receiver sends action 6 "continue" on the command channel. The app does this for cmds 12 and 17 on download, and waits for it on upload.

- **[open]** Does the device also send action 6 at the end of the last, partial batch? Does it wait for one?

### 3.4 Ride list (cmd 11)

1. App → `[11, seq<<2, 0]` (list type 0: rides not yet synced).
2. Device → response. Status 6 means no ride to sync. Status 2: see the next point.
3. **[open]** What the app does after an OK. jadx did not decompile this part well. The app seems to send nothing and wait for the data channel. Another reading is that it sends action 5, as for cmds 12 and 17.
4. Device → data channel: the start frame (entry count in bytes 7-8), then `36 × count` bytes.

36-byte entry (big-endian):

| Offset | Size | Field | Notes |
| --- | --- | --- | --- |
| 0 | 1 | `payloadSize` | **[open]** what this means |
| 1 | 4 | `fileId` | start time, Unix seconds, UTC |
| 5 | 4 | `activityTime` | **[open]** unit (s?), moving time or total time? |
| 9 | 4 | `activityDist` | **[open]** unit (m?) |
| 13 | 1 | `isWorkout` | The app has a bug here: it reads byte 13 of the **first** entry for every entry. Read it per entry. |
| 14 | 4 | `workoutId` | |
| 18 | 1 | `sportType` | **[open]** values |
| 19 | 1 | `uploadState` | only for list types 10 and 11. **[open]** values |
| 20 | 16 | ? | reserved or unknown |

**How the app avoids double downloads [app]**: the app keeps a local list of fileIds it has already downloaded and skips them. It sends nothing to the device to mark a ride as copied, and the BLE code has no delete command.

- **[open]** How the device decides that a ride is "synced", for list type 0. Maybe after a complete cmd 17 download, maybe never. This decides how Musette implements `acknowledgeActivity()`.

### 3.5 Ride download (cmd 17, ranges)

With CP bit `ftp` (0x001). Without it, the app uses cmd 12 for the whole file in one transfer, with the same flow.

1. **Size.** App → `[17, seq<<2, fileId u32, 0x01, offset=0 u32, length=4 u32]`.
2. Device → response, status 2. App → action `[17, 0x40|seq<<2, 5, flowCtrl u16]`.
3. Device → data channel transfer of 4 bytes. **[app]** The app reads them as the **file size** (u32 BE), not as the first 4 bytes of the file. **[open]** Check this.
4. **Ranges.** For each chunk of **39 600 bytes** (the last chunk is shorter): repeat steps 1-3 with `offset` and `length`. Send action 6 after each full batch (§3.3).
5. Join the chunks. On a sum error, ask for the same range again.

- **[app]** The chunk size: `BleService` uses a fixed 39 600, even though the handshake gives `devTx` (§4.2). The voice-recording download uses 3 700.
- **[app]** The result should be a FIT file. The app writes it to `fit/unsave/` and parses it.
- **[open]** `log_compress` is an app/device feature flag. I did not find any decompression in the download path. Check whether the bytes start with a FIT header (`.FIT` at offset 8) or are compressed (gzip `1f 8b`).
- **[open]** What happens if the link drops during a range. Can you resume with the next offset? Most likely yes, since each range is a separate command.

### 3.6 Send a file (cmd 16)

**Packages [app]**: for most types (see the table), the app cuts the file into **packages** of at most `devRx - 8` bytes. `devRx` comes from the handshake: 6 930 by default, 990 before the handshake. It adds an 8-byte header to each package:

```
[offset u32 BE] [total file size u32 BE] [up to devRx - 8 bytes of the file]
```

Each package is one complete cmd-16 exchange:

1. App → `[16, seq<<2, fileType]`.
2. Device → response, status 2. App → action `[16, 0x40|seq<<2, 5, flowCtrl u16]`.
3. As soon as that write completes, the app sends on the data channel: the start frame `[00 00][N u16][lastSize][0x10][seq<<2]`, then data frames up to the end of the first batch.
4. Device → action 6 "continue" → the app sends the next batch. Repeat.
5. After frame N, the app sends the end frame with the sum right away.
6. Device → action 3 (success), or action 1 (checksum error).
7. Next package: back to step 1 (new seq).

Fragment payload size: `payloadSize - 2`. `lastSize` is one byte, so `payloadSize` must be 257 or less.

**[app]** File types for cmd 16. "Pkg" means the file is cut into packages with the 8-byte header. "Raw" means it is sent as one transfer, with no header.

| Type | Content | Pkg / raw | Notes |
| --- | --- | --- | --- |
| 0 | `System.ini` | raw | **do not use**: device settings |
| 1 | altitude | raw | **[open]** format: an integer? |
| 2 | server EE (GPS ephemeris) | pkg | gzip if the server says so |
| 3, 4, 6 | firmware: OS, bootloader, BLE | pkg | **never use for tests** |
| 5, 7, 8 | device languages, notification languages, time zones | pkg | |
| 9, 15 | workout, workout JSON | pkg | |
| 10 | plan trip (Wi-Fi) | raw | |
| 11 | **plan trip (route) FIT** | pkg | gzip if the device has the `CompressPlantrip` feature |
| 12 | POI list | raw | |
| 13 | old-device image download | raw | |
| 14 | my favourites | pkg | |
| 16 | surprise me | raw | (the app also sends one in packages) |
| 17–21 | group ride | pkg | |
| 22 | map tile | raw | |
| 23 | **plan trip track `.dat`** (turn data) | pkg | built by native code (`libmain.so`, `step3AppProduceDeviceTrack`); gzip as type 11 |
| 24, 25 | live segment, live segment list | pkg | |

- **[open]** Whether the packages of one file must be sent in order, and whether the device checks `offset` and `total`.

## 4. Setting channel

### 4.1 Frame

```
[cmd u8] [type u8] [payload...] [checksum u8 = sum of all previous bytes mod 256]
```

| Type | Meaning |
| --- | --- |
| 0 | ack: a 2-byte frame `[cmd, status]`, with **no checksum** |
| 1 | set (app → device), or a value pushed by the device |
| 2 | get |
| 3 | long command (fragmented, see below) |
| 4 | get capability: `[cmd, 4, checksum]` |
| 5 | capability reply: `[cmd, 5, version u16 LE, ..., checksum]` |

- **[app]** Ack status: 10 = success, 0 = fail, 11 = not supported.
- **[app]** The app acks **every** valid device frame longer than 2 bytes with `[cmd, 10]`, and a frame with a bad checksum with `[cmd, 0]`. Cmd 54 (abort) is handled apart.
- **[app]** If CP bit 0x200 is set, the app asks for the capability version of a command (type 4) before it uses or parses that command. The frame layout depends on that version.
- **[open]** Long commands (type 3, used for names and Wi-Fi). Packets are 18 bytes with a fragment index, but jadx did not decompile all of this code.

Commands that matter to Musette (ids in `ConstSettingChannel`):

| Id | Name |
| --- | --- |
| 20 | backlight |
| 24 | battery |
| 25 | key tone |
| 27 | auto pause |
| 28 | auto lap |
| 31 | bike |
| 40 | GPS |
| 41 | log state |
| 47 | new app |
| 49 | plan trip name |
| 50 | current time |
| 52 | **handshake** |
| 54 | abort |
| 60 | plan trip |
| 63 | device inform |
| 71 | app function support |
| 83 | profile time |
| 86 | firmware update available |

There are about 80 commands in all. The layouts are in `NewSettingUtil` (`returnXxx` methods for the decoders, `setXxx` and `getXxx` for the encoders). Many are versioned.

### 4.2 Handshake (cmd 52)

**[app]** The handshake gives the transfer parameters. The app does not send a request for it in the code I read. It waits up to **30 s** after the device info (watchdog `runHandshakeWatchDog`) for a cmd-52 frame from the device.

- **[guess]** The device sends it on its own once notifications are on for the setting channel. **[open]** Confirm with a capture, and find out what triggers it.

Layout after `[52, type]` (little-endian):

| Offset | Size | Field | Use |
| --- | --- | --- | --- |
| 2 | 1 | `handShakeId` | **[guess]** an ASCII tag |
| 3 | 4 | `handShakeSize` | **`flowCtrl`**: frames per batch |
| 7 | 1 | `payloadId` | **[guess]** an ASCII tag |
| 8 | 4 | `payloadSize` | **frame size** on the data channel, 2-byte index included |
| 12 | 1 | `writeWoRespId` | **[guess]** an ASCII tag (`'W'` by default) |
| 13 | 1 | `writeWoResp` | **[open]** probably "write without response allowed" (default 1) |
| 14 | 2 | `devTx` | version ≥ 2: chunk size device → app (not used by `BleService`, see §3.5) |
| 16 | 2 | `devRx` | version ≥ 2: package size app → device (§3.6) |

- **[app]** Version 1 has no `devTx` or `devRx`. Bytes 12-13 are there only if the frame is 15 bytes long. The version comes from the capability query (type 4 → 5).
- **[guess]** With MTU 153, `payloadSize` should be 150 (ATT payload), which gives 148 data bytes per frame, the value of the app's `NEW_DEVICE_PAYLOAD_SIZE` constant.

### 4.3 Settings, as seen on a Rider 750 [dev]

Read with `musette setting caps | read | get`, written with `musette setting set` (2026-10-21). Code: `driver_bryton::settings`.

- **Get**: `[cmd, 2, args..., checksum]`. **Answer**: `[cmd, 1, payload..., checksum]`. **Set**: `[cmd, 1, payload..., checksum]`, with the **same payload layout as the answer**. Ack `[cmd, 0x0a]`.
- **Capability** (type 4 → type 5): `[cmd, 5, version u16 LE, item mask..., checksum]`. On the Rider 750, every command from 20 to 77 is version 1, except 47 (2), 58 (2), 59 (2) and 60 (3). Commands 83-87 are not supported (`[cmd, 0x0b]`). The mask lists the sub-items the device has: user 30 → `0x6f` (items 0-3, 5, 6), bike 31 → `0x21` (items 0 and 5 only: no bike weight or wheel over BLE), Wi-Fi 23 → `0x7f`, sensors 44 → `ff 07`.
- **Commands with sub-items (user 30, bike 31) take a seq byte before the item**: `[30, 2, 0, item]`, and the answer is `[30, 1, 0, item, value...]`. jadx dropped this byte in the app's get requests.

| Cmd | Get args | Answer payload | Checked against USB |
| --- | --- | --- | --- |
| 20 backlight | — | `[value]` | 6 = `blTime=6` (`DeviceData.ini`) |
| 24 battery | — | `[0, total bars, state]` (see below) | empty, then charging: matches the device |
| 25 key tone | — | `[0/1]` | 0 = `isTone=0`; **set 1 then 0 checked** |
| 26 sound | — | `[0/1]` | |
| 27 auto pause | `[bike]` | `[bike, 0/1]` | `isPause` in `Bike<n+1>Profile.ini`; **set `[2, 1]` checked** (slot 2 back on) |
| 28 auto lap | `[bike]` | `[mode << 4 \| bike, f32 dist metric, f32 dist imperial, f32 lat, f32 lon]` | |
| 29 unit | — | `[unit]` | 0 = `Unit=0` |
| 30 user | `[0, item]` | `[0, item, value]`: 0 height and 1 weight = 2 × f32 (metric, imperial); 2 birthday = u16 year, month, day; 3 gender u8; 6 language ID (ASCII, e.g. `FRA`); 5 name = long command | all equal to `UserProfile.ini` |
| 31 bike | `[seq, item, bike 0-2]` | item 0: `[0, 0, bike, prio1, prio2, prio3]` (speed source). Item 5 (name, long command): seq 0 → `[0, 5, bike, chunks=4, length=32]`, seq k → `[k, 5, bike, 14 bytes UTF-8]` | names = `Name=` in `Bike<n+1>Profile.ini` |
| 33 / 34 / 35 zones FTP / max HR / LTHR | `[item]` | `[item, u16]`; item 0 = base value | 200 / 190 / 172 = `BaseVale` |
| 40 GPS | `[bike]` | `[bike, mode]` | |
| 41 log state | — | `[item, u16 hours]` | `02 ff ff` |
| 42 trip | `[bike]` | `[bike, 4 × f32]` | |
| 45 odometer | `[bike]` | `[bike, f32 km, f32 mi]` | 8846.786 / 5497.393 = `ODOVal` (`DeviceProfile.ini`) for bike 0 |

- **[dev] [usb] Bike slots**: every per-bike command (27, 28, 31, 40, 42, 45) takes a slot 0-2, and slot n is `System/Bike<n+1>Profile.ini` (its `Name=` and `[AutoPause] isPause=`). Checked by turning auto pause off on the device for one bike: only that slot changed over BLE, and only that file changed over USB. The device's bike menu does not list the bikes in slot order. Slot 3 and more answer empty.
- **[open]** Odometer (45): slot 0 gave the device's global `ODOVal` (`DeviceProfile.ini`), and slots 1-2 gave 0. Per bike, or global under slot 0?
- **[usb]** Acknowledging a ride (cmd 51) does not delete it: the file is still on the drive, unchanged.
- **Value labels** (from the app's menu tables `BackLightMenuUtil`, `GpsMenuUtil`, `BikeSetting.getSpeedSrcOptions` and `SyncBLEViewModel`, and the user manual's menus; checked against the Rider 750's screen for auto pause):
  - backlight (20, version 1): 0 = 5 s, 1 = 15 s, 2 = 30 s, 3 = 1 min, 4 = 2 min, 5 = never, 6 = auto. Versions 2 and 3 have other lists (smart / stays on; on / off).
  - GPS (40): 0 = off, 1 = GPS + Galileo + QZSS (the manual's "Normal"), 2 = power saving, 3 = GPS + Glonass, 4 = GPS + Beidou, 5 = ultra high, 6 = on.
  - speed source (31 item 0), for each of the 3 priorities: 0 = GPS, 1 = speed sensor, 2 = speed/cadence sensor.
  - auto lap (28) mode, high nibble: 0 = off, 1 = distance, 2 = location.
  - unit (29): 0 = metric, 1 = imperial. Gender (30 item 3): 0 = female, 1 = male.
- **[app] [dev]** Battery (24): `[item, total, state]`. Item 0: bars, `total` bars (3 on the Rider 750), state 0 = charging, 1 = empty, n = n-1 bars (`ConstSettingChannel.newSettingBatteryGrid`). Item ≠ 0: `[item, percent]`. Seen: `00 03 01` (empty) just before the device switched off and again after a few minutes of charge (the screen showed a red, empty battery), `00 03 00` (charging) on a charger: checked against the screen. The device also pushes it every 5 s. Log state (41) was `02 ff ff` and later `00 ff ff` **[open]**.
- The user manual also lists per-bike **alerts** (time, distance, speed, heart rate, cadence) and system settings with no command found yet: meter colour mode, auto lock, status duration, smart recording, ODO setup, start remind, file saving, auto scroll. **[open]**

## 5. Connection sequence (as the app does it)

1. Connect and discover services. Turn on notifications for the command, data and notify channels. Ask for MTU 153.
2. When the MTU is set: cmd 6, read device info. Check `MN` (recording?) and `CP`.
3. If `CP & 0x008`: turn on notifications for the setting channel. Wait for the cmd 52 handshake, then set `flowCtrl`, the frame size and the package size.
4. The app then runs its "connect tasks" in this order: app function support (cmd 71), units, voice language, recording state, live tracking, group ride, server EE, **ride sync (cmd 11 then cmd 17)**, firmware check, debug file, time zone.
5. Ride sync runs only if `ftp` is set (else cmd 12) and the device is not recording.

- **[dev]** None of the steps in point 4 is needed. Device info → cmd 47 → handshake → file list → ranges works on a Rider 750 (§0).
- **[dev]** The handshake is not spontaneous: it comes after setting cmd 47 "set new app" (`2f 01 00 30`). In the app, cmd 47 is sent in the connect tasks, and its ack is what makes `BleService` wait for the handshake.

## 6. Route FIT (file type 11)

**[app] [usb]** This is **not** a FIT course. It is a FIT file (14-byte header, protocol 1.0, little-endian) with **only Bryton messages**: no `file_id`. The table below was checked on the 10 routes in `PlanTrip/` on the device. Messages are in file order, with the local message number that the app uses:

| Global # | Local | Name | Fields (number: base type, scale/offset) |
| --- | --- | --- | --- |
| 248 | 7 | version | 1 `major` u16, 2 `minor` u16. **[usb]** Always 0.1. |
| 254 | 1 | overview | 1 `record_count` u16 (= number of track points); 2-5 max lat, min lat, max lon, min lon sint32 (degrees ×1e6); 6 total distance u32 (m); 7-8 max alt, min alt u16 (stored as (h+500)×5); 9 gain u16 (m); 10 loss u16 (m) |
| 251 | 2 | overview record | 1 `track_index` u16. **[usb]** One per track point: 0, 1, 2… n-1. |
| 253 | 3 | turn | 1 `record_count` u16 (only if there are turn-by-turn steps) |
| 250 | 4 | turn record | 1 `track_index` u16; 2 `maneuver` enum (u8); 3 u32: **distance to the next turn, m** **[usb]** (matches the track to ±1 m); 4 u32: **[usb]** about 220 × field 3, so most likely the **duration to the next turn in ms** (16 km/h; the app calls it "duration in sec"); 5 `instruction`: a 32- or 33-byte string (street name, may be empty) |
| 252 | 5 | track | 1 `record_count` u16 |
| 249 | 6 | track record | 1 lat sint32 (degrees ×1e6, **not** semicircles); 2 lon sint32 (×1e6); 3 alt u16 (stored as (h+500)×5) |

- **[usb]** The global numbers in the files are **248–254**. The app's FIT SDK constants are these numbers × 256 (63488 = 248 × 256…): do not use the constants.
- **[usb]** The track records on the device have **3 fields**. The `grade` field (4, sint16) is defined in the app but is not in the files.
- **[app]** Points are lat/lon in degrees from the route JSON (`position_lat`, `position_long`, `altitude`).
- **[usb]** `maneuver` values seen in 10 routes (with count): 0 (4), 1 (88), 2 (189), 3 (207), 4 (39), 5 (27), 6 (23), 7 (24), 13 (146), 14 (53), 33 (10), 210–214 (76). The first turn record (index 0) has 1, so 1 is probably "start" or "go straight". The last one has 33 (one per route), so 33 is "arrive". 210–214 are probably roundabout exits 0–4. **[open]** The meaning of the others (left, right, slight, sharp…): compare with a route's instructions on the device screen.
- **[usb]** The `instruction` field is 32 bytes, and grows to `length + 1` the first time a longer text comes, then keeps that size (the app reuses one message object). Texts are at most 32 bytes. Maneuver 1 also appears along the way, not only on the first turn ("go straight"?).
- **Writer**: `driver_bryton::route::Route` encodes and decodes this format. It re-encodes the 10 routes found on a Rider 750 **byte for byte** (`BRYTON_ROUTES=<PlanTrip folder> cargo test -p driver-bryton`). `musette route build <gpx> -o <fit>` makes a route with a start and an arrival turn; `musette route dump <fit>` prints one.
- **[open]** Whether a route without turns (no turn or turn record messages) is accepted.
- **[open]** Whether file type 23 (`.dat` made by native code) is required, or only adds turn guidance. The app sends it with the "junction" feature (`PLANTRIP_JUNCTION`).
- **[open]** The route name: the app sets it with setting cmd 49 (a long command). The order (before or after the file) and the layout are not clear.
- An old helper in the app (`BbcpUtil`, maybe dead code) sends a hard-coded cmd 49 with the name `1105_登山路線` after a type-11 upload. Ignore it.

## 7. Older models

- **[app]** The app lists `Rider_530`, `Rider15`, `Rider_330`, `Rider_310` and `Rider405` as "old BT channel" models (`DEVICE_WITH_OLD_BT_CHANNEL`). I found no use of this set in the code I read. **[open]**
- **[app]** Before the handshake (and on old devices), the frame size is 20 bytes (18 data bytes), batches are 10 frames, download chunks are 990 bytes and upload packages are 6 930 bytes.
- Firmware for every model is public. The index is `https://corp.brytonsport.com/device/AllProjectsImage.rel`. Each model has `https://corp.brytonsport.com/device/<model in lower case>/release.ini` and its files in the same folder. On 2026-10-19 the index listed 28 models: Rider 10/10D/15/15neo/17/310/320/330/410/420/450/460/530/550/550neo/650/650neo/750/750SE/One, S500/S510/S800/S810, Aero 60, M3/M3S.
- The Rider 750 firmware (`IMG.bin`, OS R089) is not encrypted: it is raw ARM Cortex-M7 code, run in place at 0x9000_0000. Use it to check the device side of the handlers if a capture is not enough. The BLE chip has its own firmware (`Nordic.bin`, v03).

## 8. Tests on a real device

Do them in this order. The first five only **read**. Never send cmd 16 with types 0, 3, 4, 5, 6, 7 or 8: they write settings or firmware.

1. **GATT map (nRF Connect).** Services, characteristic properties (write, write without response, notify), advertised name and advertising data, and whether bonding is needed. Answers §1.
2. **HCI snoop captures of the official app.** Turn on "Bluetooth HCI snoop log" on Android, then capture each scenario in its own file:
   a. a plain connection, with no ride to sync;
   b. a connection that syncs **one** new short ride;
   c. sending a short route (with and without turn-by-turn, if the app allows);
   d. changing one setting (backlight, for example).

   Open them in Wireshark (`btatt`). They check §3–§5 and give test fixtures. Move or remove the GPS points before you commit them.
3. **Python client (bleak) on Linux, read only.** Turn on notifications, send cmd 6, and log the setting channel without sending anything on it. Does cmd 52 come by itself (§4.2)? Is it sent again if we do not ack? Then send cmd 11. Compare the `payloadSize` you get with the MTU that BlueZ negotiated. If you can, also try with a small MTU (23).
4. **One ride, BLE and USB.** Download one ride with cmd 17 and compare it byte for byte with the same FIT file copied over USB. Check: the size reply (4 bytes), the FIT header or compression, and the USB file name compared to `fileId`.
5. **Sync state.** List rides (type 0), download one completely, then list again. Is it still there? Try the same with a download stopped halfway, and with list types 10 and 11 (`uploadState`). Answers `acknowledgeActivity()`.
6. **Errors.** Cut the link (turn the device's BT off) during a range, reconnect and ask for the same offset. Ask for a range past the end of the file. Send a request while the device is recording (the `MN` field with `s=`, and the status code).
7. **Field units.** For 2 or 3 rides, compare `activityTime`, `activityDist` and `sportType` with the device's history screen.
8. **Route (after 1–5).** Get the type-11 FIT from capture 2c (join the packages) or from the device over USB. Decode it (`fitdump` or `crates/fit`) and note `version`, `maneuver` and the scales. Then send a copy back to the device (type 11 only, no `.dat`, no name) and check that the device shows it. Then change one point to be sure that the device uses our file.
9. **Batches.** In captures 2b and 2c, count the frames between two action-6 frames, and look at the end of the last batch (§3.3).
10. **Other models** (if you have one): run test 3 to see whether there is a handshake and what `CP` contains.
