import { loadCore } from './core';
import zones from './atlasZones.json';
import type { Device } from './devices/types';
import type { AtlasBounds } from './atlasGeometry';
import { validAtlasBounds } from './atlasGeometry';

/** Geographic windows include a little neighbouring context, rather than administrative clipping. */
export const ATLAS_ZONES = zones;

export type AtlasZone = keyof typeof ATLAS_ZONES | 'custom';

export function isRegionalAtlas(zone: AtlasZone): boolean {
  return zone !== 'france' && zone !== 'europe' && zone !== 'custom';
}

export interface AtlasOptions {
  zone: AtlasZone;
  bounds?: AtlasBounds;
  source?: 'osm' | 'included';
  rivers: boolean;
  cities: boolean;
}
export const DEFAULT_ATLAS: AtlasOptions = { zone: 'france', source: 'osm', rivers: true, cities: true };

export function atlasSelection(options: AtlasOptions): { name: string; bounds: AtlasBounds } {
  if (options.zone === 'custom') {
    if (!validAtlasBounds(options.bounds)) throw new Error('Choisissez une zone sur la carte.');
    return { name: 'Zone personnelle', bounds: options.bounds };
  }
  const zone = ATLAS_ZONES[options.zone];
  return { name: zone.name, bounds: [...zone.bounds] as AtlasBounds };
}

export function readAtlasOptions(value: unknown): AtlasOptions {
  const o = value as Partial<AtlasOptions> | undefined;
  if (!o || typeof o.rivers !== 'boolean' || typeof o.cities !== 'boolean' ||
      (o.zone !== 'custom' && !Object.hasOwn(ATLAS_ZONES, o.zone ?? '')) ||
      (o.zone === 'custom' && !validAtlasBounds(o.bounds))) return DEFAULT_ATLAS;
  return { zone: o.zone!, bounds: validAtlasBounds(o.bounds) ? o.bounds : undefined, rivers: o.rivers, cities: o.cities,
    source: o.source === 'included' && o.zone !== 'custom' ? 'included' : 'osm' };
}

export async function prepareAtlas(source: Uint8Array, options: AtlasOptions): Promise<Uint8Array> {
  const zone = atlasSelection(options);
  return (await loadCore()).cc600Atlas(source, zone.name, zone.bounds, options.rivers, options.cities);
}

export async function sendAtlas(device: Device, bytes: Uint8Array, onProgress: (ratio: number) => void, requiredVersion = 1) {
  await device.refreshInfo?.();
  const limit = device.fileLimits?.atlas;
  if (limit === undefined) throw new Error('Mettez à jour le firmware pour installer une carte globale.');
  if ((device.atlasVersion ?? 1) < requiredVersion) throw new Error('Mettez à jour le firmware pour installer une carte OpenStreetMap détaillée.');
  if (bytes.length > limit) throw new Error('Pas assez de place : choisissez une zone plus petite.');
  if (!device.uploadFile) throw new Error('L’envoi de carte globale n’est pas disponible pour ce compteur.');
  await device.uploadFile('atlas', bytes, onProgress);
  await device.refreshInfo?.();
}
