import { Pressable, Text, View } from 'react-native';
import type { RouteMapData } from '../lib/routeMap';
import { theme } from '../theme';
import { RouteMap } from './RouteMap';

/** A still map in a page (the page scrolls over it); a tap opens the full map. */
export function MapPreview({ data, onOpen }: { data: RouteMapData; onOpen(): void }) {
  return (
    <View style={{ gap: 4 }}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Ouvrir la carte en plein écran">
        <RouteMap data={data} />
        <View
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 14,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
          }}
        >
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>Agrandir</Text>
        </View>
      </Pressable>
      {/* OpenStreetMap asks for visible attribution; the full map has the complete one. */}
      <Text style={{ color: theme.muted, fontSize: 11 }}>© OpenStreetMap · OpenFreeMap</Text>
    </View>
  );
}
