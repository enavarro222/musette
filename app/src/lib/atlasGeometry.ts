/** West, south, east, north, in WGS84 degrees. Selections do not wrap the date line. */
export type AtlasBounds = [number, number, number, number];

export function validAtlasBounds(value: unknown): value is AtlasBounds {
  return Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    value[0] >= -180 && value[2] <= 180 && value[1] >= -85 && value[3] <= 85 &&
    value[2] - value[0] >= 0.0001 && value[3] - value[1] >= 0.0001;
}

export function atlasBoundsKey(bounds: AtlasBounds): string {
  return bounds.map((n) => n.toFixed(5)).join(',');
}
