import 'maplibre-gl/dist/maplibre-gl.css';
import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { atlasPreviewLayers, atlasPreviewLevel, atlasPreviewStyle } from '../lib/atlasPreview';
import { reportError } from '../lib/store';
import type { AtlasPreviewProps } from './AtlasPreview.types';

export function AtlasPreview({ data }: AtlasPreviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const dark = useColorScheme() === 'dark';
  useEffect(() => {
    let map: import('maplibre-gl').Map | undefined;
    let gone = false;
    void import('maplibre-gl').then(({ Map, NavigationControl, ScaleControl, setWorkerUrl }) => {
      if (gone || !box.current) return;
      setWorkerUrl(`${Constants.expoConfig?.experiments?.baseUrl ?? ''}/maplibre-gl-worker.mjs`);
      map = new Map({ container: box.current, style: atlasPreviewStyle(dark), bounds: data.bounds,
        fitBoundsOptions: { padding: 28 }, maxZoom: 16, minZoom: 0,
        maxBounds: [-180 + 1e-10, -85, 180 - 1e-10, 85], renderWorldCopies: false,
        dragRotate: false, pitchWithRotate: false, scrollZoom: false, attributionControl: false,
        locale: { 'NavigationControl.ZoomIn': 'Zoomer l’aperçu', 'NavigationControl.ZoomOut': 'Dézoomer l’aperçu' } });
      map.addControl(new NavigationControl({ showCompass: false }));
      map.addControl(new ScaleControl({ unit: 'metric' }));
      map.touchZoomRotate.disableRotation();
      let level = -1;
      map.on('load', () => {
        map!.resize();
        map!.fitBounds(data.bounds, { padding: 28, duration: 0 });
        level = atlasPreviewLevel(map!.getZoom(), map!.getCenter().lat);
        map!.addSource('atlas-preview', { type: 'geojson', data: data.levels[level] });
        atlasPreviewLayers(dark).forEach((layer) => map!.addLayer({ ...layer, source: 'atlas-preview' }));
      });
      map.on('moveend', () => {
        const next = atlasPreviewLevel(map!.getZoom(), map!.getCenter().lat);
        const source = map!.getSource('atlas-preview') as import('maplibre-gl').GeoJSONSource | undefined;
        if (source && level !== next) { source.setData(data.levels[next]); level = next; }
      });
    }).catch(reportError);
    return () => { gone = true; map?.remove(); };
  }, [data, dark]);
  return <div ref={box} role="region" aria-label="Aperçu de la carte à envoyer"
    style={{ height: 340, width: '100%', border: '1px solid #79918F', borderRadius: 12, overflow: 'hidden' }} />;
}
