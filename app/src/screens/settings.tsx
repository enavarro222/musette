import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Body, Choice, Muted, NumberField, Section, TextField, Toggle } from '../components/ui';
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

/** Where the last change is: sent to the device, then read back. */
export type SaveState = 'idle' | 'saving' | 'saved';

export interface SettingsEditor {
  settings?: DeviceSettings;
  edited: SettingValues;
  /** Change a setting; it is written to the device on its own, shortly after. */
  set(key: string, value: SettingValue, field: SettingField): void;
  state: SaveState;
}

/** Sliders and text send their value once the user stops moving or typing. */
const SETTLE_MS = 600;

/**
 * The settings of any device, from the fields its driver describes. Each
 * change is written right away (all or nothing, as `writeSettings` does),
 * then the settings are read back: the screen shows what the device holds.
 */
export function useSettingsEditor(device: Device | undefined): SettingsEditor {
  const [settings, setSettings] = useState<DeviceSettings>();
  const [edited, setEdited] = useState<SettingValues>({});
  const [state, setState] = useState<SaveState>('idle');
  const editable = !!device?.capabilities.settings && !!device.readSettings && !!device.writeSettings;

  // The write runs outside React's render: it reads the latest values here.
  const latest = useRef({ settings, edited });
  latest.current = { settings, edited };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const writing = useRef(false);
  const again = useRef(false);

  async function load(): Promise<DeviceSettings | undefined> {
    if (!editable) return undefined;
    try {
      const s = await device.readSettings!();
      setSettings(s);
      latest.current.settings = s;
      return s;
    } catch (e) {
      reportError(e);
      return undefined;
    }
  }

  useEffect(() => {
    clearTimeout(timer.current);
    setSettings(undefined);
    setState('idle');
    void load().then((s) => s && setEdited(s.values));
    return () => clearTimeout(timer.current);
  }, [device]);

  async function write() {
    if (writing.current) {
      again.current = true; // a change came during a write: send it after
      return;
    }
    const current = latest.current.settings;
    if (!device?.writeSettings || !current) return;
    const changes = changedValues(current.values, latest.current.edited);
    if (Object.keys(changes).length === 0) return;
    writing.current = true;
    setState('saving');
    try {
      await device.writeSettings(changes);
      await load();
      setState('saved');
    } catch (e) {
      reportError(e);
      // Refused or lost: show what the device holds.
      const s = await load();
      if (s) setEdited(s.values);
      again.current = false;
      setState('idle');
    } finally {
      writing.current = false;
    }
    if (again.current) {
      again.current = false;
      await write();
    }
  }

  return {
    settings,
    edited,
    state,
    set(key, value, field) {
      const next = { ...latest.current.edited, [key]: value };
      latest.current.edited = next;
      setEdited(next);
      clearTimeout(timer.current);
      const settle = field.type === 'number' || field.type === 'text';
      timer.current = setTimeout(() => void write(), settle ? SETTLE_MS : 0);
    },
  };
}

const STATE_TEXT: Record<SaveState, string> = {
  idle: 'Chaque changement est enregistré tout de suite sur le compteur.',
  saving: 'Enregistrement sur le compteur…',
  saved: 'Enregistré sur le compteur.',
};

const Settings = createContext<SettingsEditor | undefined>(undefined);

/** One editor for the device tab: its list of groups and each group's screen. */
export function SettingsProvider({ device, children }: { device: Device | undefined; children: ReactNode }) {
  return <Settings.Provider value={useSettingsEditor(device)}>{children}</Settings.Provider>;
}

export function useSettings(): SettingsEditor {
  const editor = useContext(Settings);
  if (!editor) throw new Error('useSettings outside SettingsProvider');
  return editor;
}

/** The groups that hold settings, in Musette's order. */
export function settingsGroups(editor: SettingsEditor) {
  return editor.settings ? groupFields(editor.settings.fields) : [];
}

/**
 * One group's settings as sections. A function, not a component: native
 * `FieldGroup` wants its sections as direct children.
 */
export function groupSections(editor: SettingsEditor, groupId: string) {
  const group = settingsGroups(editor).find((g) => g.id === groupId);
  if (!group) {
    return (
      <Section>
        <Muted>{editor.settings ? 'Ce groupe de réglages n’existe pas.' : 'Lecture des réglages du compteur…'}</Muted>
      </Section>
    );
  }
  return (
    <>
      <Section>
        <Muted>{STATE_TEXT[editor.state]}</Muted>
      </Section>
      <Section title={group.label}>
        {group.fields.map((f) => (
          <Control key={f.key} field={f} value={editor.edited[f.key]} onChange={(v) => editor.set(f.key, v, f)} />
        ))}
      </Section>
    </>
  );
}

function Control({
  field: f,
  value,
  onChange,
}: {
  field: SettingField;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
}) {
  if (f.readOnly) {
    return (
      <>
        <Body>{`${f.label} : ${String(value ?? '')}`}</Body>
        {f.help ? <Muted>{f.help}</Muted> : null}
      </>
    );
  }
  switch (f.type) {
    case 'toggle':
      return <Toggle label={f.label} help={f.help} value={value === true} onChange={onChange} />;
    case 'number':
      return (
        <NumberField
          label={f.label}
          help={f.help}
          value={Number(value ?? f.min)}
          min={f.min}
          max={f.max}
          step={f.step}
          unit={f.unit}
          onChange={onChange}
        />
      );
    case 'choice':
      return <Choice label={f.label} help={f.help} value={String(value ?? '')} options={f.options} onChange={onChange} />;
    case 'text':
      return <TextField label={f.label} help={f.help} value={String(value ?? '')} onChange={onChange} />;
  }
}
