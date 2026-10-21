import type { BrytonField, BrytonValue } from '../core';
import type { SettingField, SettingGroup, SettingValue } from '../settings';

/**
 * French labels and Musette groups of the Bryton settings. Keys, kinds,
 * choices and which ones can be written come from Rust
 * (`driver_bryton::settings`, through `brytonSettingFields`).
 */
interface Label {
  label: string;
  group: SettingGroup;
  unit?: string;
  /** French labels of a choice, indexed by value (Rust has them in English). */
  choices?: string[];
  help?: string;
}

const GLOBAL: Record<string, Label> = {
  backlight: {
    label: 'Durée du rétroéclairage',
    group: 'display',
    choices: ['5 s', '15 s', '30 s', '1 min', '2 min', 'Toujours allumé', 'Auto'],
  },
  key_tone: { label: 'Bip des touches', group: 'sound' },
  sound: { label: 'Sons des alertes et notifications', group: 'sound' },
  unit: { label: 'Unités', group: 'system', choices: ['Métriques', 'Impériales'] },
  battery: { label: 'Batterie', group: 'power' },
  'user.height': { label: 'Taille', group: 'system', unit: 'cm' },
  'user.weight': { label: 'Poids', group: 'system', unit: 'kg' },
  'user.birthday': { label: 'Date de naissance', group: 'system' },
  'user.gender': { label: 'Sexe', group: 'system', choices: ['Femme', 'Homme'] },
  'user.language': { label: 'Langue', group: 'system' },
  'zone.ftp': { label: 'FTP', group: 'ride', unit: 'W' },
  'zone.max_hr': { label: 'Fréquence cardiaque max', group: 'ride', unit: 'bpm' },
  'zone.lthr': { label: 'Fréquence cardiaque au seuil', group: 'ride', unit: 'bpm' },
};

/** Per bike (`bike0.auto_pause`...): the bike's name goes before the label. */
const PER_BIKE: Record<string, Label> = {
  auto_pause: {
    label: 'Pause intelligente',
    group: 'ride',
    help: 'Met la sortie en pause à l’arrêt et la reprend au départ.',
  },
  auto_lap: { label: 'Tour auto', group: 'ride' },
  gps: {
    label: 'Système GPS',
    group: 'navigation',
    choices: [
      'Désactivé',
      'GPS + Galileo + QZSS',
      'Économie d’énergie',
      'GPS + Glonass',
      'GPS + Beidou',
      'Très haute précision',
      'Activé',
    ],
  },
  odometer: { label: 'Odomètre', group: 'ride', unit: 'km' },
  speed_source: { label: 'Priorité des sources de vitesse', group: 'sensors' },
};

/** Settings not shown: their meaning is not settled (log state) or they are shown otherwise (names). */
const HIDDEN = new Set(['log_state']);

/** `bike2.gps` → `[2, 'gps']`. */
export function bikeOf(key: string): [number, string] | undefined {
  const m = /^bike(\d)\.(.+)$/.exec(key);
  return m ? [Number(m[1]), m[2]] : undefined;
}

/** The fields to read, in the order to read them; bike names first. */
export function shownFields(fields: BrytonField[]): BrytonField[] {
  const names = fields.filter((f) => bikeOf(f.key)?.[1] === 'name');
  return [...names, ...fields.filter((f) => !HIDDEN.has(f.key) && bikeOf(f.key)?.[1] !== 'name')];
}

const BATTERY: Record<string, string> = { charging: 'En charge', empty: 'Vide' };

function batteryText(text: string): string {
  const bars = /^(\d+)\/(\d+) bars$/.exec(text);
  return BATTERY[text] ?? (bars ? `${bars[1]} barre(s) sur ${bars[2]}` : text);
}

/**
 * The Musette field of a Bryton setting; `bikeNames` names the bike slots
 * (`undefined` when that bike has no name: the setting is left out).
 */
export function toField(f: BrytonField, bikeNames: (string | undefined)[]): SettingField | undefined {
  const bike = bikeOf(f.key);
  const l = bike ? PER_BIKE[bike[1]] : GLOBAL[f.key];
  if (!l) return undefined;
  let label = l.label;
  if (bike) {
    const name = bikeNames[bike[0]];
    if (!name) return undefined;
    label = `${name} · ${l.label}`;
  }
  const base = { key: f.key, label, group: l.group, help: l.help, readOnly: !f.writable };
  switch (f.kind) {
    case 'bool':
      return { ...base, type: 'toggle' };
    case 'choice': {
      const labels = l.choices ?? f.choices;
      return { ...base, type: 'choice', options: labels.map((label, i) => ({ value: String(i), label })) };
    }
    case 'number':
      return { ...base, type: 'number', min: 0, max: 100_000, unit: l.unit };
    default:
      return { ...base, type: 'text' };
  }
}

/** The value of a field, as the settings screen holds it. */
export function toValue(f: BrytonField, v: BrytonValue): SettingValue {
  switch (f.kind) {
    case 'bool':
      return v.number === 1;
    case 'choice':
      return String(v.number ?? '');
    case 'number':
      return Math.round((v.number ?? 0) * 10) / 10;
    default:
      return f.key === 'battery' ? batteryText(v.text) : v.text;
  }
}

/** The number Rust encodes for a value from the settings screen. */
export function toNumber(v: SettingValue): number {
  return typeof v === 'boolean' ? Number(v) : Number(v);
}
