/**
 * Device settings, the same for every device: each driver describes its
 * settings with these fields and files them in Musette's groups, so the
 * settings screen knows no device and looks the same for all of them.
 */

/** Musette's groups, in display order. A driver puts each setting in one. */
export const SETTING_GROUPS = [
  { id: 'display', label: 'Affichage' },
  { id: 'ride', label: 'Sortie' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'sensors', label: 'Capteurs' },
  { id: 'sound', label: 'Sons' },
  { id: 'power', label: 'Énergie' },
  { id: 'system', label: 'Système' },
] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number]['id'];

export type SettingValue = string | number | boolean;
export type SettingValues = Record<string, SettingValue>;

interface FieldBase {
  key: string;
  label: string;
  group: SettingGroup;
  help?: string;
  /** Shown, not editable here (for example a sensor paired from the device). */
  readOnly?: boolean;
}

export type SettingField = FieldBase &
  (
    | { type: 'toggle' }
    | { type: 'number'; min: number; max: number; step?: number; unit?: string }
    | { type: 'choice'; options: { value: string; label: string }[] }
    | { type: 'text' }
  );

export interface DeviceSettings {
  fields: SettingField[];
  values: SettingValues;
}

/** The fields of each group, groups in Musette's order, empty groups left out. */
export function groupFields(fields: SettingField[]): { id: SettingGroup; label: string; fields: SettingField[] }[] {
  return SETTING_GROUPS.map((g) => ({ ...g, fields: fields.filter((f) => f.group === g.id) })).filter(
    (g) => g.fields.length > 0,
  );
}

/** The values that differ from `initial`. */
export function changedValues(initial: SettingValues, edited: SettingValues): SettingValues {
  return Object.fromEntries(Object.entries(edited).filter(([k, v]) => initial[k] !== v));
}
