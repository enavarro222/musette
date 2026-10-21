import { FieldGroup, Host } from '@expo/ui';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';

/**
 * A screen of grouped rows: SwiftUI `Form` on iOS, Compose on Android (web:
 * `Screen.web.tsx`). `children` must be `FieldGroup.Section`s (or fragments
 * of them).
 */
export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // SwiftUI's Form keeps clear of the status bar by itself; Compose does not.
  const top = Platform.OS === 'android' ? insets.top : 0;
  return (
    <View style={{ flex: 1, paddingTop: top }}>
      <Host style={{ flex: 1 }} seedColor={theme.accent}>
        <FieldGroup>{children}</FieldGroup>
      </Host>
    </View>
  );
}
