import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCore } from './core';
import { atlasPreviewData, atlasPreviewLevel, atlasPreviewStyle } from './atlasPreview';
import type { AtlasBounds } from './atlasGeometry';

const base = new Uint8Array(readFileSync(new URL('../../assets/atlas/europe.ocat', import.meta.url)));

describe('preview of the actual global map transfer', () => {
  it('shows only the clipped and quantised geometry carried in the prepared bytes', async () => {
    const core = await loadCore();
    const bounds: AtlasBounds = [1.9, 43, 2.1, 43.2];
    const bytes = core.cc600BuildAtlas(base, 'Preview', bounds, {
      classes: ['road', 'city'], labels: ['', 'Village'], lengths: [2, 1],
      lats: [43.1, 43.1, 43.1100049], lons: [1.8, 2.2, 2.0100049],
    }, 2)!;
    const saved = bytes.slice();
    const preview = await atlasPreviewData(bytes, bounds);
    expect(preview.name).toBe('Preview');
    expect(preview.bounds).toEqual(bounds);
    expect(preview.levels).toHaveLength(3);
    for (const level of preview.levels) {
      const road = level.features.find((f) => f.properties?.kind === 'road')!;
      expect(road.geometry).toEqual({ type: 'LineString', coordinates: [[1.9, 43.1], [2.1, 43.1]] });
      const city = level.features.find((f) => f.properties?.kind === 'city')!;
      expect(city.geometry).toEqual({ type: 'Point', coordinates: [2.01, 43.11] });
      expect(city.properties?.label).toBe('Village');
      expect(level.features.some((f) => f.properties?.kind === 'river')).toBe(false);
    }
    expect(bytes).toEqual(saved);
    const style = atlasPreviewStyle(false);
    expect(style.sources).toEqual({}); // An online street basemap would show data absent from the transfer.
    expect(style.layers.every((l) => l.type === 'background')).toBe(true);
  });

  it('reads included overview files too and rejects a corrupted transfer', async () => {
    const preview = await atlasPreviewData(base, [-25, 34, 45, 72]);
    expect(preview.levels.every((level) => level.features.some((f) => f.properties?.kind === 'boundary'))).toBe(true);
    const corrupt = base.slice(); corrupt[20] ^= 1;
    await expect(atlasPreviewData(corrupt, [-25, 34, 45, 72])).rejects.toThrow('Atlas invalide');
  });

  it('switches between the stored simplification levels at geographic scale thresholds', () => {
    expect([3, 6, 12].map((zoom) => atlasPreviewLevel(zoom, 0))).toEqual([2, 1, 0]);
    expect(atlasPreviewLevel(6, 70)).toBe(0);
  });
});
