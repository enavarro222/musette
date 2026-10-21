import { FieldGroup, Host } from '@expo/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { theme } from '../theme';

/** expo-router's web tab bar floats over the top of the page. */
const TAB_BAR = 72;
/** The background of @expo/ui's web FieldGroup, for the whole page. */
const GROUND = 'var(--expo-ui-gray-50)';

/** Web: the grouped rows in a centred column, the page in their colour. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: GROUND }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingTop: TAB_BAR }}>
        <Host style={{ flex: 1 }} seedColor={theme.accent}>
          <FieldGroup>{children}</FieldGroup>
        </Host>
      </View>
    </View>
  );
}
