import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ClimbList } from '../components/ClimbList';
import { ElevationProfile } from '../components/ElevationProfile';
import { MapPreview } from '../components/MapPreview';
import { StatGrid, type Stat } from '../components/StatGrid';
import { Body, Button, Embed, Muted, Screen, Section } from '../components/ui';
import { confirmAction } from '../lib/ask';
import { readRide, type Ride, type RideSummary } from '../lib/ride';
import { routeMapData } from '../lib/routeMap';
import { fileSaver } from '../lib/save';
import { activities, shareFile, type StoredActivity } from '../lib/storage';
import { reportError } from '../lib/store';
import { duration, km, kmh } from './format';
import { rideDate } from './rides';

const round = (x: number) => Math.round(x).toLocaleString('fr-FR');

/** The figures of a ride, those its file has. */
function stats(s: RideSummary): Stat[] {
  const all: [string, string | undefined][] = [
    ['Distance', `${km(s.distanceM)} km`],
    ['Dénivelé +', s.ascentM === undefined ? undefined : `${round(s.ascentM)} m`],
    ['Temps en mouvement', duration(s.movingS)],
    ['Vitesse moyenne', s.avgSpeed === undefined ? undefined : `${kmh(s.avgSpeed)} km/h`],
    ['Vitesse max', s.maxSpeed === undefined ? undefined : `${kmh(s.maxSpeed)} km/h`],
    ['Durée totale', duration(s.elapsedS)],
    ['Dénivelé −', s.descentM === undefined ? undefined : `${round(s.descentM)} m`],
    ['FC moyenne', s.avgHeartRate === undefined ? undefined : `${round(s.avgHeartRate)} bpm`],
    ['FC max', s.maxHeartRate === undefined ? undefined : `${round(s.maxHeartRate)} bpm`],
    ['Puissance moy.', s.avgPower === undefined ? undefined : `${round(s.avgPower)} W`],
    ['Puissance max', s.maxPower === undefined ? undefined : `${round(s.maxPower)} W`],
    ['Cadence moy.', s.avgCadence === undefined ? undefined : `${round(s.avgCadence)} rpm`],
    ['Calories', s.calories === undefined ? undefined : `${round(s.calories)} kcal`],
    ['Température', s.avgTemperature === undefined ? undefined : `${round(s.avgTemperature)} °C`],
  ];
  return all.filter((x): x is [string, string] => x[1] !== undefined).map(([label, value]) => ({ label, value }));
}

/** One ride kept on this device: its figures, map, profile and climbs; share or delete it. */
export default function RideDetail() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const [stored, setStored] = useState<StoredActivity>();
  const [ride, setRide] = useState<Ride>();
  const [state, setState] = useState<'loading' | 'missing' | 'unreadable' | 'ready'>('loading');
  /** The folder files are saved in, once chosen. */
  const [folder, setFolder] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [savedIn, setSavedIn] = useState<string>();

  useEffect(() => {
    void fileSaver?.folder().then(setFolder, reportError);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const a = await activities.get(key);
        if (!a) return setState('missing');
        setStored(a);
        try {
          setRide(await readRide(a.fit));
          setState('ready');
        } catch {
          setState('unreadable');
        }
      } catch (e) {
        reportError(e);
      }
    })();
  }, [key]);

  const mapData = useMemo(() => (ride ? routeMapData(ride.track, ride.analysis) : undefined), [ride]);

  async function remove() {
    if (!stored) return;
    if (!(await confirmAction(`Supprimer « ${stored.fileName} » de cet appareil ? Cette action est définitive.`, 'Supprimer'))) {
      return;
    }
    await activities.remove(stored.key).catch(reportError);
    router.back();
  }

  async function save(choose = false) {
    if (!stored || !fileSaver) return;
    setSaving(true);
    setSavedIn(undefined);
    try {
      const where = await fileSaver.save(stored.fileName, stored.fit, choose);
      if (where) {
        setFolder(await fileSaver.folder());
        setSavedIn(where);
      }
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  const title = stored ? rideDate(stored) : 'Sortie';
  const actions = stored ? (
    <Section title="Fichier FIT">
      {fileSaver ? (
        <Button label={saving ? 'Enregistrement…' : fileSaver.label} disabled={saving} onPress={() => void save()} />
      ) : null}
      {savedIn ? <Body>{`Enregistré dans ${savedIn}.`}</Body> : null}
      {folder ? (
        <>
          <Muted>{`Dossier : ${folder}`}</Muted>
          <Button label="Enregistrer dans un autre dossier" variant="secondary" disabled={saving} onPress={() => void save(true)} />
        </>
      ) : null}
      <Button
        label="Partager le fichier FIT"
        variant="secondary"
        onPress={() => void shareFile(stored.fileName, stored.fit, 'application/vnd.ant.fit').catch(reportError)}
      />
      <Muted>{`${stored.deviceName} · ${stored.fileName} · ${(stored.fit.byteLength / 1024).toFixed(0)} Ko`}</Muted>
      <Button label="Supprimer la sortie" variant="danger" onPress={() => void remove()} />
    </Section>
  ) : null;

  if (state !== 'ready' || !ride) {
    const message = {
      loading: 'Lecture de la sortie…',
      missing: 'Cette sortie n’est plus sur cet appareil.',
      unreadable: 'Musette ne sait pas lire le contenu de ce fichier. Il reste intact : vous pouvez le partager.',
      ready: '',
    }[state];
    return (
      <Screen title={title}>
        <Section>
          <Muted>{message}</Muted>
        </Section>
        {state === 'unreadable' ? actions : null}
      </Screen>
    );
  }

  return (
    <Screen title={title}>
      <Section>
        <Embed>
          <StatGrid stats={stats(ride.summary)} />
        </Embed>
        {mapData ? (
          <Embed>
            <MapPreview
              data={mapData}
              onOpen={() => router.push({ pathname: '/ride/[key]/map', params: { key } })}
            />
          </Embed>
        ) : (
          <Muted>Pas de position GPS dans cette sortie.</Muted>
        )}
        {ride.analysis.profile.length > 1 ? (
          <Embed>
            <ElevationProfile analysis={ride.analysis} />
          </Embed>
        ) : null}
      </Section>
      <ClimbList climbs={ride.analysis.climbs} />
      {actions}
    </Screen>
  );
}
