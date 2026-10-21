import { Button, Column, FieldGroup, Row, Spacer, Text } from '@expo/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Screen } from '../components/Screen';
import { Muted } from '../components/Muted';
import { confirmAction } from '../lib/ask';
import { platform } from '../lib/platform';
import { activities, shareFile, type StoredActivity } from '../lib/storage';
import { reportError } from '../lib/store';

const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const when = (a: StoredActivity) => new Date(a.startTime ? a.startTime * 1000 : a.importedAt);

export default function Activities() {
  const [list, setList] = useState<StoredActivity[]>([]);

  const refresh = useCallback(async () => {
    try {
      setList(await activities.all());
    } catch (e) {
      reportError(e);
    }
  }, []);

  // Rides arrive from the Compteur tab: reload each time this tab shows.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function remove(a: StoredActivity) {
    if (!(await confirmAction(`Supprimer « ${a.fileName} » de cet appareil ? Cette action est définitive.`, 'Supprimer'))) {
      return;
    }
    await activities.remove(a.key).catch(reportError);
    await refresh();
  }

  const where = platform.name === 'web' ? 'dans ce navigateur' : 'sur ce téléphone';

  return (
    <Screen>
      <FieldGroup.Section title="Sorties">
        <Muted>{`Fichiers FIT stockés ${where}.`}</Muted>
        {list.length === 0 ? <Text>Aucune sortie pour l’instant. Connectez un compteur pour les récupérer.</Text> : null}
      </FieldGroup.Section>

      {list.length > 0 ? (
        <FieldGroup.Section>
          {list.map((a) => (
            <Row key={a.key} spacing={8} alignment="center">
              <Column spacing={2} alignment="start">
                <Text textStyle={{ fontWeight: '600' }}>{fmt.format(when(a))}</Text>
                <Muted>{`${a.deviceName} · ${(a.fit.byteLength / 1024).toFixed(0)} Ko`}</Muted>
              </Column>
              <Spacer flexible />
              <Button
                label="FIT"
                variant="outlined"
                onPress={() => void shareFile(a.fileName, a.fit).catch(reportError)}
              />
              <Button label="Supprimer" variant="text" onPress={() => void remove(a)} />
            </Row>
          ))}
        </FieldGroup.Section>
      ) : null}
    </Screen>
  );
}
