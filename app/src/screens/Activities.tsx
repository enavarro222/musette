import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Body, Button, ListItem, Muted, Screen, Section } from '../components/ui';
import { confirmAction } from '../lib/ask';
import { platform } from '../lib/platform';
import { activities, shareFile, type StoredActivity } from '../lib/storage';
import { reportError, useApp } from '../lib/store';
import { syncActivities } from '../lib/sync';

const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const when = (a: StoredActivity) => new Date(a.startTime ? a.startTime * 1000 : a.importedAt);

/** The rides kept on this device, and the new ones of the connected device. */
export default function Activities() {
  const { device } = useApp();
  const router = useRouter();
  const [list, setList] = useState<StoredActivity[]>([]);
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setList(await activities.all());
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

  async function remove(a: StoredActivity) {
    if (!(await confirmAction(`Supprimer « ${a.fileName} » de cet appareil ? Cette action est définitive.`, 'Supprimer'))) {
      return;
    }
    await activities.remove(a.key).catch(reportError);
    await refresh();
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
          <ListItem
            key={a.key}
            title={fmt.format(when(a))}
            detail={`${a.deviceName} · ${(a.fit.byteLength / 1024).toFixed(0)} Ko`}
          >
            <Button
              label="FIT"
              variant="secondary"
              onPress={() => void shareFile(a.fileName, a.fit).catch(reportError)}
            />
            <Button label="Supprimer" variant="danger" onPress={() => void remove(a)} />
          </ListItem>
        ))}
      </Section>
    </Screen>
  );
}
