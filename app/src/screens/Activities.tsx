import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Body, Button, LinkItem, Muted, Screen, Section } from '../components/ui';
import { platform } from '../lib/platform';
import { readRide } from '../lib/ride';
import { activities, type StoredActivity } from '../lib/storage';
import { reportError, useApp } from '../lib/store';
import { syncActivities } from '../lib/sync';
import { rideDate, rideLine } from './rides';

/** Rides kept before summaries existed: read them once, then the list shows them. */
async function summarizeMissing(list: StoredActivity[]): Promise<boolean> {
  let changed = false;
  for (const a of list.filter((a) => !a.summary)) {
    try {
      await activities.setSummary(a.key, (await readRide(a.fit)).summary);
      changed = true;
    } catch {
      // Unreadable records: the ride keeps its size in the list, its file is untouched.
    }
  }
  return changed;
}

/** The rides kept on this device, and the new ones of the connected device. */
export default function Activities() {
  const { device } = useApp();
  const router = useRouter();
  const [list, setList] = useState<StoredActivity[]>([]);
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await activities.all();
      setList(all);
      if (await summarizeMissing(all)) setList(await activities.all());
    } catch (e) {
      reportError(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function sync() {
    if (!device) return;
    setSyncing(true);
    try {
      await syncActivities(device, setStatus);
    } catch (e) {
      reportError(e);
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  const where = platform.name === 'web' ? 'dans ce navigateur' : 'sur ce téléphone';
  const canSync = !!device?.capabilities.downloadActivities;

  return (
    <Screen title="Sorties">
      <Section title="Nouvelles sorties">
        {canSync ? (
          <>
            <Muted>Copiées ici, vérifiées, puis signalées au compteur.</Muted>
            <Button
              label={syncing ? 'Récupération…' : `Récupérer depuis ${device!.name}`}
              disabled={syncing}
              onPress={() => void sync()}
            />
            {status ? <Body>{status}</Body> : null}
          </>
        ) : device ? (
          <Muted>Ce compteur ne transmet pas ses sorties.</Muted>
        ) : (
          <>
            <Muted>Connectez un compteur pour récupérer ses nouvelles sorties.</Muted>
            <Button label="Connecter un compteur" onPress={() => router.push('/connect')} />
          </>
        )}
      </Section>

      <Section title={`Historique (${where})`}>
        {list.length === 0 ? <Muted>Aucune sortie pour l’instant.</Muted> : null}
        {list.map((a) => (
          <LinkItem
            key={a.key}
            title={rideDate(a)}
            detail={rideLine(a)}
            onPress={() => router.push({ pathname: '/ride/[key]', params: { key: a.key } })}
          />
        ))}
      </Section>
    </Screen>
  );
}
