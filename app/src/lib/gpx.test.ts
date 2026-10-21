import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';

describe('GPX', () => {
  it('reads track points, with NaN for a missing elevation', async () => {
    const r = await parseGpx(`<?xml version="1.0"?>
      <gpx><trk><name>Col du test</name><trkseg>
        <trkpt lat="45.1" lon="5.2"><ele>210.5</ele></trkpt>
        <trkpt lat="45.2" lon="5.3"/>
      </trkseg></trk></gpx>`);
    expect(r.name).toBe('Col du test');
    expect(r.lats).toEqual([45.1, 45.2]);
    expect(r.lons).toEqual([5.2, 5.3]);
    expect(r.eles[0]).toBe(210.5);
    expect(r.eles[1]).toBeNaN();
  });

  it('says in French what is wrong', async () => {
    await expect(parseGpx('<gpx></gpx>')).rejects.toThrow('Le GPX ne contient pas de trace');
    await expect(parseGpx('<gpx><trkpt lon="5"/><trkpt lat="1" lon="5"/></gpx>')).rejects.toThrow('Fichier GPX illisible');
  });
});
