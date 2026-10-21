import { Button, Column, FieldGroup, Text } from '@expo/ui';
import { useState } from 'react';
import { Screen } from '../components/Screen';
import { Muted } from '../components/Muted';
import { MODELS, type ModelEntry } from '../lib/devices/registry';
import { platform } from '../lib/platform';
import { appStore, reportError, useApp } from '../lib/store';
import { syncActivities } from '../lib/sync';
import { settingsSections, useSettingsEditor } from './SettingsSections';

const CAPABILITY_LABELS: Record<string, string> = {
  downloadActivities: 'Récupération des sorties',
  uploadRoute: 'Envoi de trace',
  routeCorridorMap: 'Carte autour de la trace',
  climbsOnDevice: 'Montées sur le compteur',
  settings: 'Réglages',
  sensors: 'Capteurs',
  wifiSync: 'Synchro Wi-Fi',
};

export default function Devices({ onSynced }: { onSynced?: () => void }) {
  const { device, connecting } = useApp();
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const editor = useSettingsEditor(device);

  async function connect(model: ModelEntry) {
    const d = model.create(platform.transports);
    if (!d) return;
    appStore.set({ connecting: true });
    try {
      await d.connect();
      appStore.set({ device: d });
    } catch (e) {
      reportError(e);
    } finally {
      appStore.set({ connecting: false });
    }
  }

  async function disconnect() {
    await device?.disconnect().catch(reportError);
    appStore.set({ device: undefined });
    setStatus('');
  }

  async function sync() {
    if (!device) return;
    setSyncing(true);
    try {
      const n = await syncActivities(device, setStatus);
      if (n > 0) onSynced?.();
    } catch (e) {
      reportError(e);
    } finally {
      setSyncing(false);
    }
  }

  if (!device) {
    return (
      <Screen>
        <FieldGroup.Section title="Mon compteur">
          {MODELS.map((model) => {
            const supported = !!model.create(platform.transports);
            return (
              <Column key={model.label} spacing={6} alignment="start" style={{ paddingVertical: 8 }}>
                <Text textStyle={{ fontWeight: '600' }}>{model.label}</Text>
                <Muted>{supported ? model.connectHint : platform.unsupported}</Muted>
                <Button
                  label={connecting ? 'Connexion…' : 'Connecter'}
                  disabled={!supported || connecting}
                  onPress={() => void connect(model)}
                />
              </Column>
            );
          })}
        </FieldGroup.Section>
        {platform.name === 'web' ? (
          <FieldGroup.Section>
            <Muted>Dans le navigateur, il faut resélectionner le compteur à chaque visite.</Muted>
          </FieldGroup.Section>
        ) : null}
      </Screen>
    );
  }

  const features = Object.entries(device.capabilities)
    .filter(([, on]) => on)
    .map(([key]) => CAPABILITY_LABELS[key] ?? key)
    .join(' · ');

  return (
    <Screen>
      <FieldGroup.Section title="Mon compteur">
        <Text textStyle={{ fontWeight: '600' }}>{`${device.name} — connecté`}</Text>
        <Muted>{features}</Muted>
        <Button label="Déconnecter" variant="outlined" onPress={() => void disconnect()} />
      </FieldGroup.Section>

      {device.capabilities.downloadActivities ? (
        <FieldGroup.Section title="Sorties">
          <Muted>Copiées sur cet appareil, vérifiées, puis signalées au compteur.</Muted>
          <Button
            label={syncing ? 'Récupération…' : 'Récupérer les sorties'}
            disabled={syncing}
            onPress={() => void sync()}
          />
          {status ? <Text>{status}</Text> : null}
        </FieldGroup.Section>
      ) : null}

      {device.capabilities.settings && device.readSettings && device.writeSettings ? settingsSections(editor) : null}
    </Screen>
  );
}
