import { describe, expect, it } from 'vitest';
import { validAtlasBounds, type AtlasBounds } from './atlasGeometry';
import { atlasRectangle, dragAtlasRectangle } from './atlasRectangle';

describe('free atlas rectangle', () => {
  const original: AtlasBounds = [1, 43, 3, 45];

  it('allows a wide or tall selection while keeping the opposite corner fixed', () => {
    expect(dragAtlasRectangle(original, 'ne', [8, 44])).toEqual([1, 43, 8, 44]);
    expect(dragAtlasRectangle(original, 'sw', [2.8, 40])).toEqual([2.8, 40, 3, 45]);
    expect(dragAtlasRectangle(original, 'nw', [-2, 48])).toEqual([-2, 43, 3, 48]);
    expect(dragAtlasRectangle(original, 'se', [6, 41])).toEqual([1, 41, 6, 45]);
    expect(original).toEqual([1, 43, 3, 45]);
  });

  it('keeps a usable rectangle when a corner crosses the opposite corner or world edge', () => {
    for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
      for (const point of [[-900, -900], [900, 900], [2, 44]] as [number, number][]) {
        expect(validAtlasBounds(dragAtlasRectangle(original, handle, point))).toBe(true);
      }
    }
    expect(dragAtlasRectangle(original, 'ne', [NaN, 43])).toEqual(original);
  });

  it('moves a non-square selection without changing its size, including at the map limits', () => {
    const wide: AtlasBounds = [1, 43, 8, 44];
    for (const point of [[5, 46], [190, 100], [-190, -100]] as [number, number][]) {
      const moved = dragAtlasRectangle(wide, 'move', point);
      expect(validAtlasBounds(moved)).toBe(true);
      expect(moved[2] - moved[0]).toBeCloseTo(7);
      expect(moved[3] - moved[1]).toBeCloseTo(1);
    }
    expect(dragAtlasRectangle(wide, 'move', [10, 50])).toEqual([6.5, 49.5, 13.5, 50.5]);
  });

  it('draws the chosen geographic bounds as a closed rectangle', () => {
    const wide = dragAtlasRectangle(original, 'ne', [8, 44]);
    expect(atlasRectangle(wide).geometry.coordinates).toEqual([[[1, 44], [8, 44], [8, 43], [1, 43], [1, 44]]]);
  });
});
