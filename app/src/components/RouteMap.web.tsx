import 'maplibre-gl/dist/maplibre-gl.css';
import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { FIT_PADDING, MAP_STYLE, ROUTE_LAYERS, type RouteMapData } from '../lib/routeMap';
import { reportError } from '../lib/store';

const LOCALE = {
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + molette pour zoomer',
  'CooperativeGesturesHandler.MacHelpText': '⌘ + molette pour zoomer',
  'CooperativeGesturesHandler.MobileHelpText': 'Deux doigts pour déplacer la carte',
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
};

/** maplibre-gl's worker, copied into `public/` at install: Metro cannot bundle it. */
const WORKER_URL = `${Constants.expoConfig?.experiments?.baseUrl ?? ''}/maplibre-gl-worker.mjs`;

/** Web: maplibre-gl, loaded only when a map is shown. iOS, Android: `RouteMap.tsx`. */
export function RouteMap({ data }: { data: RouteMapData }) {
  const box = useRef<HTMLDivElement>(null);
  const dark = useColorScheme() === 'dark';

  useEffect(() => {
    let map: import('maplibre-gl').Map | undefined;
    let gone = false;
    void import('maplibre-gl')
      .then(({ Map, NavigationControl, setWorkerUrl }) => {
        if (gone || !box.current) return;
        setWorkerUrl(WORKER_URL);
        map = new Map({
          container: box.current,
          style: dark ? MAP_STYLE.dark : MAP_STYLE.light,
          bounds: data.bounds,
          fitBoundsOptions: { padding: FIT_PADDING },
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          // The page scrolls over the map; zoom with Ctrl (⌘) or two fingers.
          cooperativeGestures: true,
          locale: LOCALE,
        });
        map.addControl(new NavigationControl({ showCompass: false }));
        map.touchZoomRotate.disableRotation();
        map.on('load', () => {
          // The box may have had no size yet when the map was made: fit again.
          map!.resize();
          map!.fitBounds(data.bounds, { padding: FIT_PADDING, duration: 0 });
          map!.addSource('route', { type: 'geojson', data: data.features });
          for (const layer of ROUTE_LAYERS) map!.addLayer({ ...layer, source: 'route' });
        });
      })
      .catch(reportError);
    return () => {
      gone = true;
      map?.remove();
    };
  }, [data, dark]);

  return <div ref={box} className="route-map" aria-label="Carte de la trace" />;
}
