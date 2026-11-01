import { Asset } from 'expo-asset';
import type { AtlasOptions } from './atlas';
import { atlasAsset } from './atlasAssets';

export async function atlasSource(zone: AtlasOptions['zone']): Promise<Uint8Array> {
  const asset = Asset.fromModule(atlasAsset(zone));
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Impossible de lire le fond de carte global.');
  return new Uint8Array(await response.arrayBuffer());
}
