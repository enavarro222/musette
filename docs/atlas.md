# Permanent global atlas

Musette's **Compteur → Carte globale** screen prepares one persistent geographic
selection, independently of routes and their detailed corridors. Choose Europe,
metropolitan France, one of 13 regional windows, or **Choisir sur la carte…**.
For a manual selection, drag the rectangle's four corner handles to set its width
and height independently; the centre handle moves the whole zone. Panning,
zooming and resizing the map preserve the geographic selection. **Recentrer sur
la sélection** brings it back into view. Only the highlighted rectangle is
compiled, independently of the phone's proportions. Bounds do not wrap the date line.

## Preparation and automatic detail

**Détail automatique · OpenStreetMap** is the default. Press **Préparer la carte**
to fetch vector data for the chosen area; moving the selection does not start an
atlas download. Roads, smaller roads, paths, tracks, rivers, streams, lake/coast
outlines and named places come from OpenFreeMap's OpenMapTiles vector tiles.
Real shores are kept, artificial polygon edges along tile boundaries are omitted,
and lines crossing tile boundaries are joined. Islands are included too.
Natural Earth/Etalab bundled outlines provide context where those layers are absent.
The online data and derived atlas use ODbL attribution; code remains MIT.

The source zoom depends on the extent, up to zoom 14 and at most 256 tiles.
Downloads use at most four parallel requests, a cumulative 50 MB ceiling, and a
300,000-point limit. Features wholly outside the selected extent are discarded.
When a source is too dense, local streets, paths and streams, then lake outlines,
rivers, departments and small-place labels are shed before retrying a coarser
zoom. Main and secondary roads are retained through these source filters, so
secondary roads are not lost merely because other layers exceeded the point limit.
Native requests identify Musette with their User-Agent; browsers supply their own
identity and referrer. Source data are cached for the last area during the app
session, so changing content or the device budget reuses that download.
[OpenFreeMap's download policy](https://openfreemap.org/quick_start/).

The compiler tries actual OCAT encodings against `min(device.atlasMax, 524288)`:
first progressively simplified complete geometry, then without paths/tracks/small
streams, then without local streets and services. Motorways, trunks and primary
roads are the main axes; secondary and tertiary roads form the secondary network.
Main axes have priority. If the complete secondary network does not fit, a binary
search adds as many secondary ways as the remaining actual byte budget allows,
prioritising secondary over tertiary ways and longer lines within each rank.
Only if even a heavily simplified main network cannot fit does the compiler fall
back to geographic outlines. The preview lists the road categories retained.
Place labels are prioritised by their source rank. The selected rectangle is
never reduced to make a file fit. A failure to fit even the lightest result is
reported, without sending bytes. The final byte size and retained content are
shown before installation. Cancelling stops outstanding requests and suppresses
obsolete results. Installation refreshes the device's room before sending.

After preparation, a zoomable preview reads the final transfer file through
`musette_core::cc600_atlas_preview` and the canonical OCAT reader. It displays the
stored coordinates, labels and three simplification levels, including actual
clipping, quantisation and road selection. It uses an empty map background, so
online basemap roads cannot be mistaken for elements present in the file.
Only label fonts are fetched for this preview. Changing the zone or its contents
invalidates both the prepared file and its preview.

A connection is needed to prepare a new online area. The resulting file is
self-contained and remains on the device; drawing it needs no Internet access.
The app does not send raster tiles, a routing graph, or the downloaded source.

## Included overview data

**Fond inclus · données préchargées** remains available for predefined zones.
`tools/build_atlas.py` regenerates `app/assets/atlas/*.ocat` using the canonical
Rust encoder. Every pack is validated against the same 512 KiB budget:

- Europe (25°W–45°E, 34°N–72°N), cropped for France: public-domain Natural Earth
  country outlines, rivers and source places from 50,000 inhabitants.
- The 13 regional packs: Natural Earth roads/lakes, Etalab's 2025 departmental
  outlines (IGN Admin Express in metropolitan France), API Géo/INSEE commune
  centres from 2,000 inhabitants, and neighbouring Natural Earth places.
  These data packs are distributed under ODbL, independently of the code.

Regional windows include neighbouring context, not administrative polygon clipping.
The source URLs, attribution and licences are in `app/assets/atlas/README.md`,
with pinned input SHA256 hashes in `tools/atlas-sources.json`. Regeneration is
needed to update these bundled sources; online selections use the current tile
version supplied by OpenFreeMap. Included data use 300 m/1.5 km/7.5 km
simplification for Europe, 100 m/500 m/2.5 km for regions. These tolerances do not
claim equivalent source accuracy. The data are geographic context for a trace,
not cycling directions.

## Transfer, storage and compatibility

`TransferBegin` kind **3** sends an atlas using the resumable, CRC-checked protocol.
Its **512 KiB** limit is independent of the corridor's 512 KiB. `DeviceInfo`
retains its first 12 bytes and appends three u32 little-endian values:
`atlas_max` at 12, installed `atlas_bytes` at 16, and highest `atlas_version` at 20.
Old 12-byte handshakes have no atlas support. Old 20-byte atlas handshakes imply
OCAT v1; their included maps remain usable. The app blocks precise OSM atlas
installation with a clear firmware-update message unless version 2 is advertised.
Bryton does not advertise an atlas limit and does not expose this screen.

The firmware validates `/atlas` independently on boot, stores replacements through
`/atlas.new` and atomic rename, and acknowledges only after successful storage.
An abandoned temporary file is discarded at boot. Changing or removing `/route`
and `/map` leaves the atlas intact. Replacement needs temporary flash room in
addition to the installed file. The installed file stays in PSRAM; this is not a
flash-backed tile cache. Large incoming files use a 512 KiB allocation so freed
corridor slots can also hold a replacement atlas without fragmenting the 2 MiB PSRAM.

## OCAT versions 1 and 2

The only reader/writer lives in `route-cc600::atlas`, available to firmware,
WASM and native Musette. All numbers are little endian:

- Header: `OCAT`, version u8, UTF-8 name length u8 (at most 63), name, feature count u32.
- Version 2 then stores suggested metres/pixel as u16, based on half the
  simplification tolerance (at least 1). This describes the geometry's
  generalisation; it does not hide the atlas when zooming in. Version 1
  implicitly uses 20 m/pixel.
- Index entries: west/south/east/north (four i32 coordinates), body offset u32, body size u32.
- Body: class u8, simplification level u8 (0–2, or v2 level 3 for shared geometry), ASCII label length u8 (at most 24),
  point count u16 (at most 255), label, longitude/latitude zigzag-varint deltas from zero.
- CRC16/CCITT-FALSE of all preceding bytes. The whole file is limited to 524,288 bytes.
- Coordinates: v1 uses degrees ×1,000 (~111 m latitude); precise v2 uses degrees
  ×100,000 (~1.11 m latitude). Both retain independent geographic coordinates,
  with no active route CRC or projection binding.
- Classes: country/coast outline 0, river 1, city 2, major road 3, department 4,
  lake outline 5. Version 2 adds minor road 6, path 7, stream 8 and track 9.
  Cities have exactly one point at level zero and are shared between zoom levels.
  Version 2 also stores a line only once with level 3 when all three simplified
  geometries are identical, avoiding repeated indexes for short road segments.

The reader validates CRC, every contiguous offset, length, class, coordinate and
label before the per-frame header-only reader is used. The renderer projects the
coordinates through the active route's plane. Corridor area fills are drawn first,
then geographic atlas lines, then detailed corridor lines, atlas place labels and
the route/rider. Both maps remain visible at every zoom. A loaded corridor does
not globally suppress atlas roads or water, and a forest/residential fill cannot
erase the atlas's rivers. Zoom selects one of the three stored simplification
levels, without hiding the file based on its suggested scale. Magnified overview
geometry retains the precision and simplification of its source.
Up to 12 uppercase labels are placed, skipping collisions and overlay cards.

## Validation

Rust tests cover both coordinate scales, clipping, metre-spaced parallel ways,
simplification, all truncations, malformed indexes/arrays and legacy handshakes.
All 13 included regional packs are checked for roads/departments/towns and size.
Vitest sends precise and included files through the simulated CC600, checks exact
bytes/progress, fits synthetic dense data to a reduced device budget, and blocks
old-firmware precise transfers before any file bytes are sent. MVT fixtures cover
paths, streams, village labels, administrative boundaries, shores and islands;
fetch tests check cancellation, bounded source zoom and four concurrent requests.

Storage tests interrupt every flash operation of an atlas replacement. Firmware
simulator tests send an atlas before a route, upload/remove route and corridor,
reboot, and confirm persistence. The memory regression test holds a near-512 KiB
atlas, replaces full corridors twice, then replaces the atlas within 2 MiB PSRAM.
UI tests draw both file versions in day/night mode, including precise ways at
riding zoom, and check that bars and the route stay intact.
