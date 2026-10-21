import { Button, Column, FieldGroup, Picker, Slider, Switch, Text, TextInput } from '@expo/ui';
import { useEffect, useMemo, useState } from 'react';
import { Muted } from '../components/Muted';
import type { Device } from '../lib/devices/types';
import {
  changedValues,
  groupFields,
  type DeviceSettings,
  type SettingField,
  type SettingValue,
  type SettingValues,
} from '../lib/settings';
import { reportError } from '../lib/store';

export interface SettingsEditor {
  settings?: DeviceSettings;
  edited: SettingValues;
  set(key: string, value: SettingValue): void;
  changed: number;
  saving: boolean;
  saved: boolean;
  save(): Promise<void>;
}

/** The settings of any device, from the fields its driver describes. */
export function useSettingsEditor(device: Device | undefined): SettingsEditor {
  const [settings, setSettings] = useState<DeviceSettings>();
  const [edited, setEdited] = useState<SettingValues>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editable = !!device?.capabilities.settings && !!device.readSettings && !!device.writeSettings;

  async function load() {
    if (!editable) return;
    try {
      const s = await device.readSettings!();
      setSettings(s);
      setEdited(s.values);
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    setSettings(undefined);
    setSaved(false);
    void load();
  }, [device]);

  const changes = useMemo(() => (settings ? changedValues(settings.values, edited) : {}), [settings, edited]);

  return {
    settings,
    edited,
    set(key, value) {
      setEdited((e) => ({ ...e, [key]: value }));
      setSaved(false);
    },
    changed: Object.keys(changes).length,
    saving,
    saved,
    async save() {
      setSaving(true);
      try {
        await device!.writeSettings!(changes);
        // Read back what the device now holds.
        await load();
        setSaved(true);
      } catch (e) {
        reportError(e);
      } finally {
        setSaving(false);
      }
    },
  };
}

/**
 * The settings as sections, in Musette's groups. A function, not a component:
 * `FieldGroup` wants its sections as direct children.
 */
export function settingsSections(editor: SettingsEditor) {
  const { settings, edited, changed, saving, saved } = editor;
  if (!settings) {
    return (
      <FieldGroup.Section title="Réglages">
        <Muted>Lecture des réglages du compteur…</Muted>
      </FieldGroup.Section>
    );
  }
  return (
    <>
      {groupFields(settings.fields).map((group) => (
        <FieldGroup.Section key={group.id} title={group.label}>
          {group.fields.map((f) => (
            <Column key={f.key} spacing={4} alignment="start">
              <Control field={f} value={edited[f.key]} onChange={(v) => editor.set(f.key, v)} disabled={saving} />
              {f.help ? <Muted>{f.help}</Muted> : null}
            </Column>
          ))}
        </FieldGroup.Section>
      ))}
      <FieldGroup.Section>
        <Button
          label={saving ? 'Enregistrement…' : changed ? `Enregistrer (${changed})` : 'Enregistrer'}
          disabled={!changed || saving}
          onPress={() => void editor.save()}
        />
        {saved && !changed ? <Muted>Réglages enregistrés sur le compteur.</Muted> : null}
      </FieldGroup.Section>
    </>
  );
}

function Control({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
  disabled: boolean;
}) {
  if (field.readOnly) return <Text>{`${field.label} : ${String(value ?? '')}`}</Text>;
  switch (field.type) {
    case 'toggle':
      return <Switch label={field.label} value={value === true} onValueChange={onChange} disabled={disabled} />;
    case 'number': {
      const n = Number(value ?? field.min);
      const step = field.step ?? 1;
      return (
        <Column spacing={4} alignment="start">
          <Text>{`${field.label} : ${n}${field.unit ? ` ${field.unit}` : ''}`}</Text>
          <Slider
            value={n}
            min={field.min}
            max={field.max}
            // Compose draws a tick per step: only when there are few.
            step={(field.max - field.min) / step <= 20 ? step : undefined}
            disabled={disabled}
            onValueChange={(v) => onChange(Math.min(field.max, Math.max(field.min, Math.round(v / step) * step)))}
          />
        </Column>
      );
    }
    case 'choice':
      return (
        <Column spacing={4} alignment="start">
          <Text>{field.label}</Text>
          <Picker selectedValue={String(value ?? '')} onValueChange={onChange} enabled={!disabled}>
            {field.options.map((o) => (
              <Picker.Item key={o.value} label={o.label} value={o.value} />
            ))}
          </Picker>
        </Column>
      );
    case 'text':
      return (
        <Column spacing={4} alignment="start">
          <Text>{field.label}</Text>
          <TextInput defaultValue={String(value ?? '')} onChangeText={onChange} editable={!disabled} />
        </Column>
      );
  }
}
