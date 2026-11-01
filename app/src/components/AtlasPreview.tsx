import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { atlasPreviewLayers, atlasPreviewLevel, atlasPreviewStyle } from '../lib/atlasPreview';
import type { AtlasPreviewProps } from './AtlasPreview.types';

export function AtlasPreview({ data }: AtlasPreviewProps) {
  const dark = useColorScheme() === 'dark';
  const [level, setLevel] = useState(0);
  const style = useMemo(() => atlasPreviewStyle(dark), [dark]);
  const layers = useMemo(() => atlasPreviewLayers(dark), [dark]);
  return <View accessibilityLabel="Aperçu de la carte à envoyer"
    style={{ height: 340, borderWidth: 1, borderColor: '#79918F', borderRadius: 12, overflow: 'hidden' }}>
    <Map style={{ flex: 1 }} mapStyle={style} logo={false} attribution={false} compass={false} scaleBar
      touchRotate={false} touchPitch={false}
      onRegionDidChange={({ nativeEvent }) => setLevel(atlasPreviewLevel(nativeEvent.zoom, nativeEvent.center[1]))}>
      <Camera initialViewState={{ bounds: data.bounds, padding: { top: 28, bottom: 28, left: 28, right: 28 } }} minZoom={0} maxZoom={16} />
      <GeoJSONSource id="atlas-preview" data={data.levels[level]}>
        {layers.map((layer) => <Layer key={layer.id} {...layer} />)}
      </GeoJSONSource>
    </Map>
  </View>;
}
