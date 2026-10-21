import { useRouter } from 'expo-router';
import { Button, LinkItem, ListItem, Muted, Screen, Section } from '../components/ui';
import { appStore, reportError, useApp } from '../lib/store';
import { settingsGroups, useSettings } from './settings';

const CAPABILITY_LABELS: Record<string, string> = {
  downloadActivities: 'Récupération des sorties',
  uploadRoute: 'Envoi de trace',
  routeCorridorMap: 'Carte autour de la trace',
  climbsOnDevice: 'Montées sur le compteur',
  settings: 'Réglages',
  sensors: 'Capteurs',
  wifiSync: 'Synchro Wi-Fi',
};

/** The connected device and its settings, by group (each group on its screen). */
export default function DeviceHome() {
  const { device } = useApp();
  const editor = useSettings();
  const router = useRouter();

  if (!device) {
    return (
      <Screen title="Compteur" noDeviceStatus>
        <Section title="Aucun compteur connecté">
          <Muted>Connectez-le pour voir et changer ses réglages, récupérer ses sorties et lui envoyer des traces.</Muted>
          <Button label="Connecter un compteur" onPress={() => router.push('/connect')} />
        </Section>
      </Screen>
    );
  }

  async function disconnect() {
    await device?.disconnect().catch(reportError);
    appStore.set({ device: undefined });
  }

  const features = Object.entries(device.capabilities)
    .filter(([, on]) => on)
    .map(([key]) => CAPABILITY_LABELS[key] ?? key)
    .join(' · ');
  const hasSettings = device.capabilities.settings && !!device.readSettings && !!device.writeSettings;

  return (
    <Screen title="Compteur" noDeviceStatus>
      <Section title="Connecté">
        <ListItem title={device.name} detail={features} />
        <Button label="Déconnecter" variant="danger" onPress={() => void disconnect()} />
      </Section>
      {hasSettings ? (
        <Section title="Réglages">
          {editor.settings ? (
            settingsGroups(editor).map((g) => (
              <LinkItem
                key={g.id}
                title={g.label}
                detail={g.fields.map((f) => f.label).join(', ')}
                onPress={() => router.push(`/device/${g.id}`)}
              />
            ))
          ) : (
            <Muted>Lecture des réglages du compteur…</Muted>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}
