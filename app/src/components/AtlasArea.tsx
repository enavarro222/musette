import { Camera, GeoJSONSource, Layer, Map, ViewAnnotation, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import { Text, useColorScheme, View } from 'react-native';
import { ATLAS_AREA_LAYERS, ATLAS_HANDLES, atlasHandlePosition, atlasRectangle, dragAtlasRectangle, type AtlasHandle } from '../lib/atlasRectangle';
import { MAP_STYLE } from '../lib/routeMap';
import type { AtlasAreaProps } from './AtlasArea.types';

const padding = { top: 42, bottom: 42, left: 42, right: 42 };

/** Native draggable annotations control the same geographic rectangle as on the web. */
export function AtlasArea({ initialBounds, disabled, fitRequest, onChange }: AtlasAreaProps) {
  const [start] = useState(initialBounds);
  const [bounds, setBounds] = useState(initialBounds);
  const selected = useRef(bounds);
  const origin = useRef(bounds);
  const camera = useRef<CameraRef>(null);
  const lastFit = useRef(fitRequest);
  const dark = useColorScheme() === 'dark';
  useEffect(() => {
    if (fitRequest !== lastFit.current) camera.current?.fitBounds(selected.current, { padding, duration: 250 });
    lastFit.current = fitRequest;
  }, [fitRequest]);
  function drag(handle: AtlasHandle, point: [number, number], commit: boolean) {
    if (disabled) return;
    const next = dragAtlasRectangle(origin.current, handle, point);
    selected.current = next; setBounds(next);
    if (commit) onChange(next);
  }
  return <View accessibilityLabel="Choisir la zone de la carte globale" pointerEvents={disabled ? 'none' : 'auto'}
    style={{ height: 340, borderRadius: 12, borderWidth: 1, borderColor: '#79918F', overflow: 'hidden' }}>
    <Map style={{ flex: 1 }} mapStyle={dark ? MAP_STYLE.dark : MAP_STYLE.light} logo={false}
      compass={false} attribution touchRotate={false} touchPitch={false}>
      <Camera ref={camera} initialViewState={{ bounds: start, padding }} minZoom={0} maxZoom={16} maxBounds={[-180 + 1e-10, -85, 180 - 1e-10, 85]} />
      <GeoJSONSource id="atlas-area" data={atlasRectangle(bounds)}>
        {ATLAS_AREA_LAYERS.map((layer) => <Layer key={layer.id} {...layer} />)}
      </GeoJSONSource>
      {ATLAS_HANDLES.map(({ id, label }) => <ViewAnnotation key={id} id={`atlas-${id}`} lngLat={atlasHandlePosition(bounds, id)} draggable={!disabled}
        onDragStart={() => { origin.current = selected.current; }}
        onDrag={({ nativeEvent }) => drag(id, nativeEvent.lngLat, false)}
        onDragEnd={({ nativeEvent }) => drag(id, nativeEvent.lngLat, true)}>
        <View collapsable={false} accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 24, height: 24, borderWidth: 3, borderColor: '#0B6E69', backgroundColor: '#fff', borderRadius: id === 'move' ? 12 : 5, alignItems: 'center', justifyContent: 'center' }}>
            {id === 'move' ? <Text style={{ color: '#0B6E69', fontSize: 18, lineHeight: 18 }}>✥</Text> : null}
          </View>
        </View>
      </ViewAnnotation>)}
    </Map>
  </View>;
}
