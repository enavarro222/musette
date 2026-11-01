import { PbfWriter } from 'pbf';

/** A feature of a test tile: type (2 line, 3 polygon), properties, rings in tile units. */
interface TestFeature {
  type: 1 | 2 | 3;
  props: Record<string, string>;
  rings: [number, number][][];
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/** A vector tile (MVT 2.1) with these layers, extent 4096. */
export function mvt(layers: Record<string, TestFeature[]>): Uint8Array {
  const pbf = new PbfWriter();
  for (const [name, features] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: string[] = [];
    const index = (list: string[], v: string) => (list.includes(v) ? list.indexOf(v) : list.push(v) - 1);
    const encoded = features.map((f) => {
      const tags = Object.entries(f.props).flatMap(([k, v]) => [index(keys, k), index(values, v)]);
      const geometry: number[] = [];
      let [cx, cy] = [0, 0];
      for (const ring of f.rings) {
        const points = f.type === 3 ? ring.slice(0, -1) : ring;
        points.forEach(([x, y], i) => {
          if (i === 0) geometry.push(1 | (1 << 3));
          if (i === 1) geometry.push(2 | ((points.length - 1) << 3));
          geometry.push(zigzag(x - cx), zigzag(y - cy));
          [cx, cy] = [x, y];
        });
        if (f.type === 3) geometry.push(7 | (1 << 3));
      }
      return { type: f.type, tags, geometry };
    });
    pbf.writeMessage(
      3,
      (_: null, p: PbfWriter) => {
        p.writeVarintField(15, 2);
        p.writeStringField(1, name);
        for (const f of encoded) {
          p.writeMessage(
            2,
            (_: null, q: PbfWriter) => {
              q.writePackedVarint(2, f.tags);
              q.writeVarintField(3, f.type);
              q.writePackedVarint(4, f.geometry);
            },
            null,
          );
        }
        for (const k of keys) p.writeStringField(3, k);
        for (const v of values) p.writeMessage(4, (_: null, q: PbfWriter) => q.writeStringField(1, v), null);
        p.writeVarintField(5, 4096);
      },
      null,
    );
  }
  return pbf.finish();
}

