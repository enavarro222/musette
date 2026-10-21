import { useLocalSearchParams } from 'expo-router';
import { Muted, Screen, Section } from '../components/ui';
import { useApp } from '../lib/store';
import { groupSections, settingsGroups, useSettings } from './settings';

/** One group of the device's settings (Affichage, Capteurs…). */
export default function DeviceGroup() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const { device } = useApp();
  const editor = useSettings();
  const label = settingsGroups(editor).find((g) => g.id === group)?.label ?? 'Réglages';

  return (
    <Screen title={label} noDeviceStatus>
      {device ? (
        groupSections(editor, group)
      ) : (
        <Section>
          <Muted>Le compteur est déconnecté.</Muted>
        </Section>
      )}
    </Screen>
  );
}
