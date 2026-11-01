import 'maplibre-gl/dist/maplibre-gl.css';
import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { ATLAS_AREA_LAYERS, ATLAS_HANDLES, atlasHandlePosition, atlasRectangle, dragAtlasRectangle } from '../lib/atlasRectangle';
import { MAP_STYLE } from '../lib/routeMap';
import { reportError } from '../lib/store';
import type { AtlasAreaProps } from './AtlasArea.types';

/** The geographic rectangle stays independent of map navigation and viewport size. */
export function AtlasArea({ initialBounds, disabled, fitRequest, onChange }: AtlasAreaProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | undefined>(undefined);
  const change = useRef(onChange);
  const selected = useRef(initialBounds);
  const blocked = useRef(disabled);
  const [start] = useState(initialBounds);
  const dark = useColorScheme() === 'dark';
  useEffect(() => { change.current = onChange; blocked.current = disabled; }, [onChange, disabled]);
  useEffect(() => {
    mapRef.current?.fitBounds(selected.current, { padding: 42, duration: 250 });
  }, [fitRequest]);
  useEffect(() => {
    let map: import('maplibre-gl').Map | undefined;
    let gone = false;
    const markers: import('maplibre-gl').Marker[] = [];
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl, setWorkerUrl }) => {
      if (gone || !box.current) return;
      setWorkerUrl(`${Constants.expoConfig?.experiments?.baseUrl ?? ''}/maplibre-gl-worker.mjs`);
      map = new Map({ container: box.current, style: dark ? MAP_STYLE.dark : MAP_STYLE.light,
        bounds: selected.current, fitBoundsOptions: { padding: 42 }, maxZoom: 16, minZoom: 0,
        // +/-180 project to the same wrapped x in MapLibre's constraint math.
        maxBounds: [-180 + 1e-10, -85, 180 - 1e-10, 85],
        dragRotate: false, pitchWithRotate: false, scrollZoom: false, renderWorldCopies: false,
        attributionControl: { compact: true },
        locale: { 'NavigationControl.ZoomIn': 'Zoomer', 'NavigationControl.ZoomOut': 'Dézoomer' },
      });
      mapRef.current = map;
      map.addControl(new NavigationControl({ showCompass: false }));
      map.touchZoomRotate.disableRotation();
      const draw = () => {
        (map!.getSource('atlas-area') as import('maplibre-gl').GeoJSONSource | undefined)?.setData(atlasRectangle(selected.current));
        markers.forEach((marker, i) => marker.setLngLat(atlasHandlePosition(selected.current, ATLAS_HANDLES[i].id)));
      };
      map.on('load', () => {
        map!.resize();
        map!.addSource('atlas-area', { type: 'geojson', data: atlasRectangle(selected.current) });
        ATLAS_AREA_LAYERS.forEach((layer) => map!.addLayer({ ...layer, source: 'atlas-area' }));
        ATLAS_HANDLES.forEach(({ id, label, cursor }) => {
          const button = document.createElement('button');
          button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
          Object.assign(button.style, { width: '44px', height: '44px', padding: '10px', border: '0',
            background: 'transparent', cursor, touchAction: 'none' });
          const grip = document.createElement('span');
          Object.assign(grip.style, { display: 'grid', placeItems: 'center', width: '24px', height: '24px',
            boxSizing: 'border-box', background: '#fff', border: '3px solid #0B6E69', borderRadius: id === 'move' ? '50%' : '5px',
            color: '#0B6E69', fontSize: '18px', lineHeight: '18px', boxShadow: '0 1px 5px #0005', pointerEvents: 'none' });
          if (id === 'move') grip.textContent = '✥';
          button.append(grip);
          const marker = new Marker({ element: button, draggable: true, subpixelPositioning: true })
            .setLngLat(atlasHandlePosition(selected.current, id)).addTo(map!);
          markers.push(marker);
          let origin = selected.current;
          marker.on('dragstart', () => { origin = selected.current; });
          const drag = (commit: boolean) => {
            if (blocked.current) return;
            const p = marker.getLngLat();
            selected.current = dragAtlasRectangle(origin, id, [p.lng, p.lat]);
            draw();
            if (commit) change.current(selected.current);
          };
          marker.on('drag', () => drag(false));
          marker.on('dragend', () => drag(true));
          button.addEventListener('keydown', (event) => {
            const step = event.shiftKey ? 30 : 5;
            const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const d = delta[event.key];
            if (!d || blocked.current) return;
            event.preventDefault(); event.stopPropagation();
            const pixel = map!.project(atlasHandlePosition(selected.current, id));
            const p = map!.unproject([pixel.x + d[0], pixel.y + d[1]]);
            selected.current = dragAtlasRectangle(selected.current, id, [p.lng, p.lat]);
            draw(); change.current(selected.current);
          });
        });
      });
    }).catch(reportError);
    return () => { gone = true; markers.forEach((marker) => marker.remove()); map?.remove(); mapRef.current = undefined; };
  }, [dark, start]);
  return <div ref={box} role="region" aria-label="Choisir la zone de la carte globale" aria-disabled={disabled}
    style={{ height: 340, width: '100%', borderRadius: 12, border: '1px solid #79918F', overflow: 'hidden', pointerEvents: disabled ? 'none' : 'auto' }} />;
}
