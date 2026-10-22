import type { DeviceField, DeviceSetting } from '../core';
import type { SettingField, SettingGroup, SettingValue } from '../settings';
import { settingValue } from './bleDevice';

interface Presentation {
  label: string;
  group: SettingGroup;
  help?: string;
  unit?: string;
  step?: number;
  /** Labels of a choice's words. */
  options?: Record<string, string>;
}

const SENSOR_HELP = 'Appairage depuis le compteur (menu Capteurs).';

/** How Musette shows each CC600 setting. Keys and values come from the Rust crate. */
export const CC600_SETTINGS: Record<string, Presentation> = {
  theme: { label: 'Thème', group: 'display', options: { day: 'Jour', night: 'Nuit' } },
  backlight: { label: 'Rétroéclairage', group: 'display', unit: '%', step: 10 },
  scroll_s: { label: 'Défilement des pages', group: 'display', unit: 's' },
  usage: {
    label: 'Usage',
    group: 'ride',
    help: 'Choisit les pages affichées pendant la sortie.',
    options: { explore: 'Explorer', train: 'S’entraîner' },
  },
  follow_route: {
    label: 'Suivre la trace chargée',
    group: 'navigation',
    help: 'Désactivé : parcours libre, la trace reste sur le compteur.',
  },
  ftp: {
    label: 'FTP',
    group: 'ride',
    unit: 'W',
    step: 5,
    help: 'Puissance au seuil, le 100 % des zones de puissance. 0 : pas de zones.',
  },
  hr_max: {
    label: 'FC max',
    group: 'ride',
    unit: 'bpm',
    help: 'Le 100 % des zones cardio. 0 : pas de zones.',
  },
  power_zones: {
    label: 'Zones de puissance',
    group: 'ride',
    help: 'Haut de chaque zone sauf la dernière, en % de la FTP (Coggan : 55,75,90,105,120,150).',
  },
  hr_zones: {
    label: 'Zones cardio',
    group: 'ride',
    help: 'Haut de chaque zone sauf la dernière, en % de la FC max (60,70,80,90 : 5 zones).',
  },
  hr: { label: 'Cardio', group: 'sensors', help: SENSOR_HELP },
  speed_cadence: { label: 'Vitesse et cadence', group: 'sensors', help: SENSOR_HELP },
  power: { label: 'Puissance', group: 'sensors', help: SENSOR_HELP },
  sound: { label: 'Bips', group: 'sound' },
  auto_off_min: {
    label: 'Extinction automatique',
    group: 'power',
    unit: 'min',
    help: 'Après ce temps à l’arrêt pendant une sortie (elle est conservée). 0 : jamais.',
  },
  tz: { label: 'Fuseau horaire', group: 'system', help: 'Passage à l’heure d’été automatique.' },
  trip_log: {
    label: 'Journal technique',
    group: 'system',
    help: 'Pour la mise au point : prend environ 5 fois la place d’une sortie.',
  },
};

/** POSIX rules offered for the time zone; the device accepts any. */
export const TIME_ZONES: Record<string, string> = {
  'CET-1CEST,M3.5.0,M10.5.0/3': 'Europe centrale',
  'GMT0BST,M3.5.0/1,M10.5.0': 'Royaume-Uni, Irlande',
  'WET0WEST,M3.5.0/1,M10.5.0': 'Portugal',
  'EET-2EEST,M3.5.0/3,M10.5.0/4': 'Europe de l’Est',
  UTC0: 'UTC',
};

/** `none`, `ble:r:E0:…:07`, `ant:121:12345:1` in words. */
export function sensorLabel(v: string): string {
  if (v === 'none') return 'Aucun';
  if (v.startsWith('ble:')) return `Bluetooth ${v.slice(6)}`;
  if (v.startsWith('ant:')) return `ANT+ ${v.split(':')[2]}`;
  return v;
}

/** The generic field of a CC600 setting. `current` is its value on the device. */
export function toField(f: DeviceField, current: string): SettingField {
  const p = CC600_SETTINGS[f.key] ?? { label: f.key, group: 'system' };
  const base = { key: f.key, label: p.label, group: p.group, help: p.help };
  if (!f.writable) return { ...base, type: 'text', readOnly: true }; // a sensor, paired from the device
  if (f.key === 'tz') {
    const zones = { ...(current in TIME_ZONES ? {} : { [current]: current }), ...TIME_ZONES };
    return { ...base, type: 'choice', options: Object.entries(zones).map(([value, label]) => ({ value, label })) };
  }
  switch (f.kind) {
    case 'bool':
      return { ...base, type: 'toggle' };
    case 'number':
      return { ...base, type: 'number', min: f.min ?? 0, max: f.max ?? 0, step: p.step, unit: p.unit };
    case 'choice':
      return { ...base, type: 'choice', options: f.options.map((value) => ({ value, label: p.options?.[value] ?? value })) };
    default:
      return { ...base, type: 'text' };
  }
}

/** A device value as the app shows it. */
export function toValue(f: DeviceField, v: DeviceSetting): SettingValue {
  return f.writable ? settingValue(f, v) : sensorLabel(v.text);
}
