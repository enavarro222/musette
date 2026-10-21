import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useColorScheme, View } from 'react-native';
import { FIT_PADDING, MAP_STYLE, ROUTE_LAYERS, type RouteMapData } from '../lib/routeMap';

/** iOS, Android: a native MapLibre map. Web: `RouteMap.web.tsx`. */
export function RouteMap({ data }: { data: RouteMapData }) {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={{ height: 300, borderRadius: 12, overflow: 'hidden' }} accessibilityLabel="Carte de la trace">
      <Map
        style={{ flex: 1 }}
        mapStyle={dark ? MAP_STYLE.dark : MAP_STYLE.light}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
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
