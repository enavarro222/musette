import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, LinkItem, Muted, Screen, Section } from '../components/ui';
import { pickGpx } from '../lib/files';
import { importRoute } from '../lib/library';
import { platform } from '../lib/platform';
import { routes, type RouteSummary } from '../lib/storage';
import { reportError } from '../lib/store';
import { km } from './format';

/** The routes kept on this device: prepared without the device, sent when it is there. */
export default function RouteLibrary() {
  const router = useRouter();
  const [list, setList] = useState<RouteSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      setList(await routes.all());
    } catch (e) {
      reportError(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function add() {
    try {
      const gpx = await pickGpx();
      if (gpx === undefined) return;
      const r = await importRoute(gpx);
      router.push(`/routes/${r.id}`);
    } catch (e) {
      reportError(e);
    }
  }

  const where = platform.name === 'web' ? 'dans ce navigateur' : 'sur ce téléphone';

  return (
    <Screen title="Traces">
      <Section>
        <Button label="Ajouter un GPX" onPress={() => void add()} />
        <Muted>Exporté depuis Komoot, Openrunner ou un autre outil.</Muted>
      </Section>
      <Section title={`Mes traces (${where})`}>
        {list.length === 0 ? <Muted>Aucune trace pour l’instant.</Muted> : null}
        {list.map((r) => (
          <LinkItem
            key={r.id}
            title={r.name}
            detail={`${km(r.distanceM)} km · ${Math.round(r.ascentM)} m D+`}
            onPress={() => router.push(`/routes/${r.id}`)}
          />
        ))}
      </Section>
    </Screen>
  );
}
