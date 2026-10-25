import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { RouteMap } from '../components/RouteMap';
import { Muted, Screen, Section } from '../components/ui';
import { routeMapData } from '../lib/routeMap';
import { useRoute } from './useRoute';

/** A route on the full screen: the map moves and zooms. */
export default function RouteMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { route, analysis, missing } = useRoute(id);
  const name = route?.name ?? 'Carte';
  const data = useMemo(() => (route && analysis ? routeMapData(route, analysis) : undefined), [route, analysis]);

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
