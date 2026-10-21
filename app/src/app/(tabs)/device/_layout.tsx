import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { SettingsProvider } from '../../../screens/settings';
import { useApp } from '../../../lib/store';
import { theme } from '../../../theme';

const web = Platform.OS === 'web';

/** The device tab: its screens share the settings being edited. */
export default function DeviceStack() {
  const { device } = useApp();
  return (
    <SettingsProvider device={device}>
      <Stack screenOptions={{ headerShown: !web, headerTintColor: theme.accent }} />
    </SettingsProvider>
  );
}
