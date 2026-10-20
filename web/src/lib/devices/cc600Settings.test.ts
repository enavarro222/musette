import { describe, expect, it } from 'vitest';
import * as core from '../wasm/pkg/musette_wasm';
import { changedValues, groupFields, SETTING_GROUPS } from '../settings';
import { FakeCc600 } from '../../test/fakeCc600';
import { Cc600Device } from './cc600';
import { CC600_SETTINGS, type Cc600Field, TIME_ZONES } from './cc600Settings';

async function connected(fake: FakeCc600) {
  const device = new Cc600Device(fake, { requestMs: 300, stallMs: 50 });
  await device.connect();
  return device;
}

describe('CC600 settings', () => {
  it('presents every setting the device has, and nothing else', () => {
    const keys = (core.cc600SettingsFields() as Cc600Field[]).map((f) => f.key);
    expect(Object.keys(CC600_SETTINGS).sort()).toEqual([...keys].sort());
    const groups: string[] = SETTING_GROUPS.map((g) => g.id);
    for (const p of Object.values(CC600_SETTINGS)) expect(groups).toContain(p.group);
  });

  it('offers only time zones the device accepts', () => {
    for (const tz of Object.keys(TIME_ZONES)) {
      expect(() => core.cc600SettingsApply('', `tz=${tz}\n`), tz).not.toThrow();
    }
  });

  it('reads the settings as typed values, in Musette groups', async () => {
    const fake = new FakeCc600({ settings: 'sound=off\nbacklight=80\nhr=ant:120:4242:1\n' });
    const { fields, values } = await (await connected(fake)).readSettings();
    expect(values.sound).toBe(false);
    expect(values.backlight).toBe(80);
    expect(values.scroll_s).toBe(4); // default
    expect(values.hr).toBe('ANT+ 4242');
    expect(fields.find((f) => f.key === 'backlight')).toMatchObject({ type: 'number', min: 0, max: 100, unit: '%' });
    expect(fields.find((f) => f.key === 'hr')).toMatchObject({ type: 'text', readOnly: true, group: 'sensors' });
    expect(groupFields(fields).map((g) => g.id)).toEqual(SETTING_GROUPS.map((g) => g.id));
  });

  it('keeps a time zone the app does not list', async () => {
    const fake = new FakeCc600({ settings: 'tz=EST5EDT,M3.2.0,M11.1.0\n' });
    const { fields, values } = await (await connected(fake)).readSettings();
    const tz = fields.find((f) => f.key === 'tz');
    expect(values.tz).toBe('EST5EDT,M3.2.0,M11.1.0');
    expect(tz?.type === 'choice' && tz.options.map((o) => o.value)).toContain('EST5EDT,M3.2.0,M11.1.0');
  });

  it('sends only what changed', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    const { values } = await device.readSettings();
    const edited = { ...values, sound: false, backlight: 30, theme: 'night' };
    await device.writeSettings(changedValues(values, edited));
    expect(fake.settingsWrites).toEqual(['sound=off\ntheme=night\nbacklight=30\n']);
    const after = await device.readSettings();
    expect(after.values).toEqual(edited);
  });

  it('changes nothing when the device refuses a value, and names the setting', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    const before = fake.settings;
    await expect(device.writeSettings({ sound: false, scroll_s: 99 })).rejects.toThrow(
      'Le compteur a refusé le réglage « Défilement des pages »',
    );
    expect(fake.settings).toBe(before);
  });

  it('never sends a read-only setting', async () => {
    const fake = new FakeCc600();
    const device = await connected(fake);
    await expect(device.writeSettings({ hr: 'Aucun' })).rejects.toThrow();
    expect(fake.settingsWrites).toEqual([]);
  });
});
