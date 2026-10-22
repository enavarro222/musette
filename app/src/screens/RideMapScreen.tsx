import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RouteMap } from '../components/RouteMap';
import { Muted, Screen, Section } from '../components/ui';
import { readRide } from '../lib/ride';
import { routeMapData, type RouteMapData } from '../lib/routeMap';
import { activities } from '../lib/storage';
import { reportError } from '../lib/store';
import { rideDate } from './rides';

/** A ride on the full screen: the map moves and zooms. */
export default function RideMapScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const [name, setName] = useState('Carte');
  const [data, setData] = useState<RouteMapData>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const a = await activities.get(key);
        if (!a) return setMissing(true);
        setName(rideDate(a));
        const ride = await readRide(a.fit);
        setData(routeMapData(ride.track, ride.analysis));
      } catch (e) {
        reportError(e);
      }
    })();
  }, [key]);

  if (!data) {
    return (
      <Screen title={name}>
        <Section>
          <Muted>{missing ? 'Cette sortie n’est plus sur cet appareil.' : 'Lecture de la sortie…'}</Muted>
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
