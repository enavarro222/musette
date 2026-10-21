import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RouteMap } from '../components/RouteMap';
import { Muted, Screen, Section } from '../components/ui';
import { loadCore } from '../lib/core';
import { parseGpx } from '../lib/gpx';
import { routeMapData, type RouteMapData } from '../lib/routeMap';
import { routes } from '../lib/storage';
import { reportError } from '../lib/store';

/** A route on the full screen: the map moves and zooms. */
export default function RouteMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('Carte');
  const [data, setData] = useState<RouteMapData>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await routes.get(id);
        if (!stored) return setMissing(true);
        const route = await parseGpx(stored.gpx);
        setName(route.name);
        setData(routeMapData(route, (await loadCore()).analyzeRoute(route.lats, route.lons, route.eles)));
      } catch (e) {
        reportError(e);
      }
    })();
  }, [id]);

  if (!data) {
    return (
      <Screen title={name}>
        <Section>
          <Muted>{missing ? 'Cette trace n’est plus sur cet appareil.' : 'Lecture de la trace…'}</Muted>
        </Section>
      </Screen>
    );
  }
  return (
    <Screen title={name} fill>
      <RouteMap data={data} full />
    </Screen>
  );
}
