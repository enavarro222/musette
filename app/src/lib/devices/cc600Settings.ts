import type { Cc600Field } from '../core';
import type { SettingField, SettingGroup, SettingValue, SettingValues } from '../settings';

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
export function toField(f: Cc600Field, current: string): SettingField {
  const p = CC600_SETTINGS[f.key] ?? { label: f.key, group: 'system' };
  const base = { key: f.key, label: p.label, group: p.group, help: p.help };
  switch (f.kind) {
    case 'onOff':
      return { ...base, type: 'toggle' };
    case 'range':
      return { ...base, type: 'number', min: f.min ?? 0, max: f.max ?? 0, step: p.step, unit: p.unit };
    case 'choice':
      return { ...base, type: 'choice', options: f.options.map((value) => ({ value, label: p.options?.[value] ?? value })) };
    case 'tz': {
      const zones = { ...(current in TIME_ZONES ? {} : { [current]: current }), ...TIME_ZONES };
      return { ...base, type: 'choice', options: Object.entries(zones).map(([value, label]) => ({ value, label })) };
    }
    case 'sensor':
      return { ...base, type: 'text', readOnly: true };
  }
}

/** A device value (text) as the app shows it. */
export function toValue(f: Cc600Field, raw: string): SettingValue {
  switch (f.kind) {
    case 'onOff':
      return raw === 'on';
    case 'range':
      return Number(raw);
    case 'sensor':
      return sensorLabel(raw);
    default:
      return raw;
  }
}

/** Changed values as the `key=value` lines `SetSettings` carries. Read-only settings are never sent. */
export function toLines(fields: Cc600Field[], changes: SettingValues): string {
  return Object.entries(changes)
    .map(([key, v]) => {
      const f = fields.find((x) => x.key === key);
      if (!f || f.kind === 'sensor') throw new Error(`Réglage non modifiable : ${key}`);
      const text = typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'number' ? String(Math.round(v)) : v;
      return `${key}=${text}\n`;
    })
    .join('');
}
