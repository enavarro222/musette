import type { DeviceField, DeviceSetting } from '../core';
import type { SettingField, SettingGroup, SettingValue, SettingValues } from '../settings';
import { settingValue } from './bleDevice';
import type { NumberEntryOptions } from '../numberEntry';

interface Presentation {
  label: string;
  group: SettingGroup;
  help?: string;
  inactiveReason?: (values: SettingValues) => string | undefined;
  unit?: string;
  step?: number;
  entry?: NumberEntryOptions;
  advanced?: boolean;
  /** Labels of a choice's words. */
  options?: Record<string, string>;
  optionHelp?: Record<string, string>;
}

const SENSOR_HELP = 'Appairage depuis le compteur (menu Capteurs).';

/** Labels and display order of CC600 settings. Keys and values come from the Rust crate. */
export const CC600_SETTINGS: Record<string, Presentation> = {
  ftp: {
    label: 'FTP',
    group: 'ride',
    unit: 'W',
    step: 1,
    entry: { emptyValue: 0, placeholder: 'Non renseignée' },
    help: 'Ta puissance au seuil, utilisée pour les zones de puissance. Laisse vide si tu ne la connais pas.',
  },
  hr_max: {
    label: 'FC max',
    group: 'ride',
    unit: 'bpm',
    step: 1,
    entry: { emptyValue: 0, placeholder: 'Non renseignée' },
    help: 'Ta fréquence cardiaque maximale, utilisée pour les zones cardio. Laisse vide si tu ne la connais pas.',
  },
  usage: {
    label: 'Ordre des pages',
    group: 'display',
    help: 'Au prochain départ. L’enregistrement de la sortie reste identique.',
    options: { explore: 'Exploration', train: 'Entraînement' },
    optionHelp: {
      explore: 'La carte s’affiche en premier si tu suis une trace, sinon la page Essentiel. La page puissance ou cardio reste accessible avec un capteur connecté.',
      train: 'La puissance ou le cardio s’affiche en premier avec un capteur connecté, sinon la page Essentiel. La carte reste accessible si tu suis une trace.',
    },
  },
  auto_night: {
    label: 'Thème nuit automatique',
    group: 'display',
    help: 'Du coucher au lever du soleil, à la position du compteur.',
  },
  theme: {
    label: 'Thème',
    group: 'display',
    options: { day: 'Jour', night: 'Nuit' },
    help: 'Aspect de l’écran en mode manuel.',
    inactiveReason: (v) => v.auto_night === true ? 'Thème automatique activé : désactivez-le pour choisir Jour ou Nuit.' : undefined,
  },
  auto_backlight: {
    label: 'Rétroéclairage automatique',
    group: 'display',
    help: 'Suit la lumière ambiante.',
  },
  backlight: {
    label: 'Rétroéclairage',
    group: 'display',
    unit: '%',
    step: 10,
    help: 'Sans le rétroéclairage automatique.',
    inactiveReason: (v) => v.auto_backlight === true ? 'Sans effet : le rétroéclairage automatique est activé.' : undefined,
  },
  scroll_s: { label: 'Défilement des pages', group: 'display', unit: 's' },
  auto_pause: {
    label: 'Pause automatique',
    group: 'ride',
    help: 'Arrête le chrono sous le seuil de vitesse et reprend dès qu’il est atteint. La moyenne utilise le temps en mouvement.',
  },
  auto_pause_kmh: {
    label: 'Seuil de pause automatique',
    group: 'ride',
    unit: 'km/h',
    step: 0.1,
    help: '1,5 km/h par défaut. Le temps total inclut toujours les pauses.',
    inactiveReason: (v) => v.auto_pause === false ? 'Sans effet : activez la pause automatique pour régler son seuil.' : undefined,
  },
  follow_route: {
    label: 'Suivre la trace chargée',
    group: 'navigation',
    help: 'Désactivé : parcours libre, la trace reste sur le compteur.',
  },

  power_zones: {
    advanced: true,
    label: 'Zones de puissance',
    group: 'ride',
    help: 'Haut de chaque zone sauf la dernière, en % de la FTP (Coggan : 55,75,90,105,120,150).',
    inactiveReason: (v) => v.ftp === 0 ? 'Sans effet : renseignez une FTP supérieure à 0 pour utiliser les zones de puissance.' : undefined,
  },

  hr_zones: {
    advanced: true,
    label: 'Zones cardio',
    group: 'ride',
    help: 'Haut de chaque zone sauf la dernière, en % de la FC max (60,70,80,90 : 5 zones).',
    inactiveReason: (v) => v.hr_max === 0 ? 'Sans effet : renseignez une FC max supérieure à 0 pour utiliser les zones cardio.' : undefined,
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
  const base = { key: f.key, label: p.label, group: p.group, help: p.help, inactiveReason: p.inactiveReason, advanced: p.advanced };
  if (!f.writable) return { ...base, type: 'text', readOnly: true }; // a sensor, paired from the device
  if (f.key === 'tz') {
    const zones = { ...(current in TIME_ZONES ? {} : { [current]: current }), ...TIME_ZONES };
    return { ...base, type: 'choice', options: Object.entries(zones).map(([value, label]) => ({ value, label })) };
  }
  switch (f.kind) {
    case 'bool':
      return { ...base, type: 'toggle' };
    case 'number':
      return { ...base, type: 'number', min: f.min ?? 0, max: f.max ?? 0, step: p.step, unit: p.unit, entry: p.entry };
    case 'choice':
      return { ...base, type: 'choice', options: f.options.map((value) => ({ value, label: p.options?.[value] ?? value, help: p.optionHelp?.[value] })) };
    default:
      return { ...base, type: 'text' };
  }
}

/** A device value as the app shows it. */
export function toValue(f: DeviceField, v: DeviceSetting): SettingValue {
  return f.writable ? settingValue(f, v) : sensorLabel(v.text);
}
