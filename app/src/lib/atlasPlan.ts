import { loadCore, type AtlasClass, type AtlasFeatures, type Core } from './core';
import { atlasSelection, prepareAtlas, type AtlasOptions } from './atlas';
import { atlasRoadTier, fetchAtlasOsm, isAtlasWater, type AtlasOsmData, type AtlasOsmFeature, type AtlasProgress } from './atlasOsm';

export const ATLAS_BUDGET = 512 * 1024;
export interface AtlasPlan {
  bytes: Uint8Array;
  detail: string;
  toleranceM?: number;
  reduced: boolean;
  source: 'osm' | 'included';
  zoom?: number;
}
interface Choice {
  toleranceM: number;
  omit: AtlasClass[];
  cities: number;
  /** 0: main axes, 1: secondary network, 2: local streets too; -1: no roads. */
  roads: number;
  secondary?: number;
}
const SMALL_WAYS: AtlasClass[] = ['path', 'track', 'stream'];
const CHOICES: Choice[] = [
  ...[2, 5, 15, 40, 100, 250].map((toleranceM) => ({ toleranceM, omit: [] as AtlasClass[], cities: 4000, roads: 2 })),
  ...[50, 150, 400].map((toleranceM) => ({ toleranceM, omit: SMALL_WAYS, cities: 1500, roads: 2 })),
  ...[50, 150, 400].map((toleranceM) => ({ toleranceM, omit: SMALL_WAYS, cities: 1000, roads: 1 })),
  ...[150, 500, 1500].map((toleranceM) => ({ toleranceM, omit: SMALL_WAYS, cities: 500, roads: 0 })),
  ...[3000, 10_000].map((toleranceM) => ({ toleranceM, omit: [...SMALL_WAYS, 'river', 'lake', 'department'] as AtlasClass[], cities: 100, roads: 0 })),
  { toleranceM: 3000, omit: ['path', 'track', 'river', 'stream', 'lake'], cities: 100, roads: -1 },
  { toleranceM: 10_000, omit: ['path', 'track', 'river', 'stream', 'lake', 'city', 'department'], cities: 0, roads: -1 },
];

function flat(features: AtlasOsmFeature[], choice: Choice, options: AtlasOptions): AtlasFeatures {
  const out: AtlasFeatures = { classes: [], labels: [], lengths: [], lats: [], lons: [] };
  let cities = 0, secondary = 0;
  for (const f of features) {
    if (choice.omit.includes(f.cls) || (!options.rivers && isAtlasWater(f.cls)) || (!options.cities && f.cls === 'city')) continue;
    const road = atlasRoadTier(f);
    if (road !== undefined && road > choice.roads && !(road === 1 && choice.roads === 0 && secondary++ < (choice.secondary ?? 0))) continue;
    if (f.cls === 'city' && cities++ >= choice.cities) continue;
    out.classes.push(f.cls); out.labels.push(f.label); out.lengths.push(f.lats.length);
    for (let i = 0; i < f.lats.length; i++) { out.lats.push(f.lats[i]); out.lons.push(f.lons[i]); }
  }
  return out;
}

function roadLength(f: AtlasOsmFeature): number {
  let length = 0;
  for (let i = 1; i < f.lats.length; i++) length += Math.hypot(
    (f.lons[i] - f.lons[i - 1]) * Math.cos(f.lats[i] * Math.PI / 180), f.lats[i] - f.lats[i - 1]);
  return length;
}

function detailOf(features: AtlasFeatures, selected: AtlasOsmFeature[]): string {
  const kinds = new Set(features.classes);
  return [
    kinds.has('road') ? 'Grands axes' : '',
    kinds.has('minor') && selected.some((f) => atlasRoadTier(f) === 1) ? 'Routes secondaires' : '',
    kinds.has('minor') && selected.some((f) => atlasRoadTier(f) === 2) ? 'Rues et dessertes' : '',
    kinds.has('path') || kinds.has('track') ? 'Chemins et pistes' : '',
    [...kinds].some(isAtlasWater) ? 'Eau' : '',
    kinds.has('city') ? 'Lieux' : '',
    kinds.has('boundary') || kinds.has('department') ? 'Limites' : '',
  ].filter(Boolean).join(' · ') || 'Contours géographiques';
}

/** Try complete encodings against the actual device budget. Coverage is never cropped to make a file fit. */
export async function fitAtlas(
  core: Core, base: Uint8Array, data: AtlasOsmData, options: AtlasOptions, limit: number,
  progress?: (progress: AtlasProgress) => void, signal?: AbortSignal,
): Promise<AtlasPlan> {
  const budget = Math.min(ATLAS_BUDGET, limit);
  if (!Number.isFinite(budget) || budget < 1) throw new Error('Le compteur ne dispose pas de place pour une carte globale.');
  const selection = atlasSelection(options);
  const secondary = data.features.filter((f) => atlasRoadTier(f) === 1)
    .map((feature) => ({ feature, length: roadLength(feature) }))
    .sort((a, b) => (a.feature.roadRank ?? 3) - (b.feature.roadRank ?? 3) || b.length - a.length)
    .map(({ feature }) => feature);
  const features = [...data.features.filter((f) => atlasRoadTier(f) !== 1), ...secondary];
  const yieldWork = async () => {
    if (signal?.aborted) throw Object.assign(new Error('Préparation annulée.'), { name: 'AbortError' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw Object.assign(new Error('Préparation annulée.'), { name: 'AbortError' });
  };
  for (const [i, choice] of CHOICES.entries()) {
    progress?.({ phase: 'compile', done: i, total: CHOICES.length });
    // Let the UI show progress/cancel before the synchronous shared compiler.
    await yieldWork();
    let selected = flat(features, choice, options);
    let bytes = core.cc600BuildAtlas(base, selection.name, selection.bounds, selected, choice.toleranceM);
    if (!bytes || bytes.length > budget) continue;
    // A complete secondary network may not fit. Fill the remaining room with
    // its most important/longest ways instead of dropping every secondary road.
    if (choice.roads === 0 && secondary.length) {
      let low = 0, high = secondary.length;
      while (low < high) {
        await yieldWork();
        const count = Math.ceil((low + high) / 2);
        const candidate = flat(features, { ...choice, secondary: count }, options);
        const encoded = core.cc600BuildAtlas(base, selection.name, selection.bounds, candidate, choice.toleranceM);
        if (encoded && encoded.length <= budget) { low = count; selected = candidate; bytes = encoded; }
        else high = count - 1;
      }
    }
    const retained = new Set(selected.classes);
    const detail = detailOf(selected, features.filter((f) => retained.has(f.cls) &&
      (atlasRoadTier(f) !== 2 || choice.roads === 2)));
    return { bytes, detail, toleranceM: choice.toleranceM, reduced: i > 0, source: 'osm', zoom: data.zoom };
  }
  throw new Error('Même le fond le plus léger ne tient pas dans la place disponible. Réduisez la zone ou libérez des sorties déjà copiées.');
}

export async function prepareGlobalAtlas(
  base: Uint8Array, options: AtlasOptions, limit = ATLAS_BUDGET,
  work: { signal?: AbortSignal; onProgress?: (progress: AtlasProgress) => void; get?: typeof fetch } = {},
): Promise<AtlasPlan> {
  if (options.source === 'included' && options.zone !== 'custom') {
    const bytes = await prepareAtlas(base, options);
    if (bytes.length > Math.min(limit, ATLAS_BUDGET)) throw new Error('Ce fond inclus dépasse la place disponible. Choisissez le détail automatique ou une zone plus petite.');
    return { bytes, detail: 'Fond inclus', reduced: false, source: 'included' };
  }
  const core = await loadCore();
  const data = await fetchAtlasOsm(atlasSelection(options).bounds, work);
  return fitAtlas(core, base, data, options, limit, work.onProgress, work.signal);
}
