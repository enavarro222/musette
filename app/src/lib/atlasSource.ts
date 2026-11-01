import { Asset } from 'expo-asset';
import type { AtlasOptions } from './atlas';
import { atlasAsset } from './atlasAssets';
import { File } from 'expo-file-system';

export async function atlasSource(zone: AtlasOptions['zone']): Promise<Uint8Array> {
  const [asset] = await Asset.loadAsync(atlasAsset(zone));
  return new File(asset.localUri ?? asset.uri).bytes();
}
