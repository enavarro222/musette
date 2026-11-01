# Permanent atlas

`europe.ocat` contains Natural Earth country outlines, rivers and city points
in the window 25°W–45°E, 34°N–72°N, in three simplification levels. Towns have
at least 50,000 inhabitants in the source dataset. Coordinates are quantised
to 0.001°. This is a geographic reference map, without roads or routing.

Data are public domain: https://www.naturalearthdata.com/about/terms-of-use/
Source: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

Regenerate from the repository root with `python3 tools/build_atlas.py`.
The shared Rust OCAT encoder checks the result and its 512 KiB maximum.
Musette can select a smaller geographic window, and omit rivers or towns,
without fetching online map tiles. The atlas assets are bundled on every platform.

## Enriched regional packs

The other 13 `.ocat` files add major/secondary roads, lakes, departmental
outlines and commune centres from 2,000 inhabitants. Their windows are
defined once in `app/src/lib/atlasZones.json` and include neighbouring context.
Each pack is independently validated against 512 KiB; only the selected pack
is sent to the device.

Sources and attribution:

- Natural Earth (public domain): roads, lakes, country outlines, rivers and
  neighbouring foreign places, from the same GeoJSON repository above.
- IGN / Etalab, [Contours administratifs 2025](https://www.data.gouv.fr/datasets/contours-administratifs):
  departmental outlines at 100 m generalisation, from
  https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/departements-100m.geojson .
- INSEE / API Géo / Etalab, [commune population and centres](https://geo.api.gouv.fr/decoupage-administratif/communes):
  https://geo.api.gouv.fr/communes?fields=nom,code,population,centre&format=json&geometry=centre .

These regional data packs are available under the
[Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Original data are available at the URLs above; the transformation is in
`tools/build_atlas.py`, with all input SHA256 hashes in `tools/atlas-sources.json`.
The licence applies to the data, independently of Musette's MIT-licensed code.
