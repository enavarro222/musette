import { useEffect, useMemo, useState } from 'react';
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

/** The settings of any device, from the fields its driver describes. */
export default function Settings({ device }: { device: Device }) {
  const [settings, setSettings] = useState<DeviceSettings>();
  const [edited, setEdited] = useState<SettingValues>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const s = await device.readSettings!();
      setSettings(s);
      setEdited(s.values);
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    void load();
  }, [device]);

  const changes = useMemo(() => (settings ? changedValues(settings.values, edited) : {}), [settings, edited]);
  const changed = Object.keys(changes).length;

  function set(key: string, value: SettingValue) {
    setEdited((e) => ({ ...e, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await device.writeSettings!(changes);
      // Read back what the device now holds.
      await load();
      setSaved(true);
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <section className="card">
        <div className="title">Réglages</div>
        <p className="muted" aria-live="polite">
          Lecture des réglages du compteur…
        </p>
      </section>
    );
  }

  return (
    <>
      {groupFields(settings.fields).map((group) => (
        <section className="card list" key={group.id}>
          <div className="title">{group.label}</div>
          {group.fields.map((f) => (
            <label className="row setting" key={f.key}>
              <div className="grow">
                <span>{f.label}</span>
                {f.help && <span className="muted small">{f.help}</span>}
              </div>
              <Control field={f} value={edited[f.key]} onChange={(v) => set(f.key, v)} disabled={saving} />
            </label>
          ))}
        </section>
      ))}

      <button type="button" className="primary block" disabled={!changed || saving} onClick={save}>
        {saving ? 'Enregistrement…' : changed ? `Enregistrer (${changed})` : 'Enregistrer'}
      </button>
      {saved && !changed && (
        <p className="small center" aria-live="polite">
          Réglages enregistrés sur le compteur.
        </p>
      )}
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
  if (field.readOnly) return <span className="muted">{String(value ?? '')}</span>;
  switch (field.type) {
    case 'toggle':
      return (
        <input
          type="checkbox"
          className="switch"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case 'number':
      return (
        <span className="number">
          <input
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number(value ?? field.min)}
            disabled={disabled}
            onChange={(e) => {
              const v = e.currentTarget.valueAsNumber;
              if (!Number.isNaN(v)) onChange(Math.min(field.max, Math.max(field.min, v)));
            }}
          />
          {field.unit && <span className="muted">{field.unit}</span>}
        </span>
      );
    case 'choice':
      return (
        <select value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'text':
      return (
        <input type="text" value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)} />
      );
  }
}
