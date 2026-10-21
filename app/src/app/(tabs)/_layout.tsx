import { NativeTabs } from 'expo-router/native-tabs';
import { theme } from '../../theme';

/** iOS and Android: native tabs (web: `_layout.web.tsx`). */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={theme.accent} labelVisibilityMode="labeled">
      <NativeTabs.Trigger name="(activities)">
        <NativeTabs.Trigger.Label>Sorties</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="list" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="routes">
        <NativeTabs.Trigger.Label>Traces</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="device">
        <NativeTabs.Trigger.Label>Compteur</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bicycle" md="directions_bike" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="project">
        <NativeTabs.Trigger.Label>Projet</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="info.circle" md="info" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
