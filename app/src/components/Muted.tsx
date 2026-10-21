import { Text } from '@expo/ui';
import { theme } from '../theme';

/** Secondary text: hints, sizes, states. */
export function Muted({ children }: { children: string }) {
  return (
    <Text textStyle={{ color: theme.muted, fontSize: 14 }}>
      {children}
    </Text>
  );
}
