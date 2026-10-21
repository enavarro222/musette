import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { theme } from '../../../theme';

const web = Platform.OS === 'web';

/** A tab's own stack: native header bar (the web shows its own heading). */
export default function TabStack() {
  return <Stack screenOptions={{ headerShown: !web, headerTintColor: theme.accent }} />;
}
