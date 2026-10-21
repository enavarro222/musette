import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useColorScheme, View } from 'react-native';
import { FIT_PADDING, MAP_STYLE, ROUTE_LAYERS } from '../lib/routeMap';
import type { RouteMapProps } from './RouteMap.types';

/** iOS, Android: a native MapLibre map. Web: `RouteMap.web.tsx`. */
export function RouteMap({ data, full }: RouteMapProps) {
  const dark = useColorScheme() === 'dark';
  return (
    <View
      style={full ? { flex: 1 } : { height: 260, borderRadius: 12, overflow: 'hidden' }}
      accessibilityLabel="Carte de la trace"
      // The preview takes no touches: the page scrolls, a tap opens the full map.
      pointerEvents={full ? 'auto' : 'none'}
    >
      <Map
        style={{ flex: 1 }}
        mapStyle={dark ? MAP_STYLE.dark : MAP_STYLE.light}
        logo={false}
        compass={false}
        attribution={full}
        touchRotate={false}
        touchPitch={false}
        dragPan={full}
        touchZoom={full}
        doubleTapZoom={full}
      >
        <Camera initialViewState={{ bounds: data.bounds, padding: FIT_PADDING }} />
        <GeoJSONSource id="route" data={data.features}>
          {ROUTE_LAYERS.map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </GeoJSONSource>
      </Map>
    </View>
  );
}

