import { Text, useColorScheme, View } from 'react-native';
import { theme } from '../theme';

export interface Stat {
  label: string;
  value: string;
}

/** Figures in a grid, three a row: the value large, its label under it. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  const ink = useColorScheme() === 'dark' ? '#F2F2F2' : '#1C1C1E';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
      {stats.map((s) => (
        <View key={s.label} style={{ width: '33.33%', paddingRight: 8 }}>
          <Text style={{ color: ink, fontSize: 20, fontWeight: '600' }}>{s.value}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}
