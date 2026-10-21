import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, ListItem, Muted, Screen, Section } from '../components/ui';
import { BLE_MODELS, MODELS, modelOf, openBle } from '../lib/devices/registry';
import type { Device } from '../lib/devices/types';
import { platform } from '../lib/platform';
import { appStore, reportError, useApp } from '../lib/store';
import type { BlePeer } from '../lib/transport/types';

/** A search stops by itself after this long; the user can start it again. */
const SCAN_MS = 20_000;

const { ble, bleScan, blePick } = platform.transports;
const WANTED = BLE_MODELS.map((m) => m.ble!.options);
const HINTS = BLE_MODELS.map((m) => m.ble!.hint ?? m.connectHint).join(' ');
const OTHERS = MODELS.filter((m) => m.create);

/**
 * The device chooser: connecting is app-wide, every tab then sees the device.
 * One Bluetooth search finds every supported model; the device found tells
 * which model it is. Other devices (USB) are listed by model.
 */
export default function Connect() {
  const { connecting } = useApp();
  const router = useRouter();
  const [peers, setPeers] = useState<BlePeer[]>([]);
  const [scanning, setScanning] = useState(!!(ble && bleScan));

  useEffect(() => {
    if (!scanning || !bleScan) return;
    const stop = bleScan(
      WANTED,
      (peer) => setPeers((ps) => [...ps.filter((p) => p.id !== peer.id), peer]),
      (e) => {
        reportError(e);
        setScanning(false);
      },
    );
    const timer = setTimeout(() => setScanning(false), SCAN_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [scanning]);

  async function connect(open: () => Promise<Device | undefined>) {
    setScanning(false);
    appStore.set({ connecting: true });
    try {
      const d = await open();
      if (!d) return;
      await d.connect();
      appStore.set({ device: d });
      if (router.canGoBack()) router.back();
      else router.replace('/device');
    } catch (e) {
      reportError(e);
    } finally {
      appStore.set({ connecting: false });
    }
  }

  const connectLabel = connecting ? 'Connexion…' : 'Connecter';
  const sorted = [...peers].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return (
    <Screen title="Connecter un compteur" noDeviceStatus>
      <Section title="Bluetooth">
        {!ble ? (
          <Muted>{platform.unsupported}</Muted>
        ) : blePick ? (
          <Button
            label={connecting ? 'Connexion…' : 'Rechercher un compteur'}
            disabled={connecting}
            onPress={() => void connect(async () => openBle(platform.transports, await blePick(WANTED)))}
          />
        ) : (
          <>
            <Muted>{scanning ? 'Recherche des compteurs à proximité…' : 'Recherche terminée.'}</Muted>
            {sorted.map((p) => (
              <ListItem
                key={p.id}
                title={p.name}
                detail={[modelOf(p).label, p.rssi === undefined ? '' : `signal ${p.rssi} dBm`].filter(Boolean).join(' · ')}
              >
                <Button
                  label={connectLabel}
                  variant="secondary"
                  disabled={connecting}
                  onPress={() => void connect(async () => openBle(platform.transports, p))}
                />
              </ListItem>
            ))}
            {!scanning && peers.length === 0 ? (
              <Muted>Aucun compteur trouvé. Est-il allumé, en mode association, et à côté du téléphone ?</Muted>
            ) : null}
            {!scanning ? (
              <Button
                label="Relancer la recherche"
                variant="secondary"
                onPress={() => {
                  setPeers([]);
                  setScanning(true);
                }}
              />
            ) : null}
          </>
        )}
        {ble ? <Muted>{HINTS}</Muted> : null}
        {blePick ? <Muted>Dans le navigateur, il faut resélectionner le compteur à chaque visite.</Muted> : null}
      </Section>

      {OTHERS.length > 0 ? (
        <Section title="Autres compteurs">
          {OTHERS.map((model) => {
            const supported = !!model.create!(platform.transports);
            return (
              <ListItem key={model.label} title={model.label} detail={supported ? model.connectHint : platform.unsupported}>
                <Button
                  label={connectLabel}
                  variant="secondary"
                  disabled={!supported || connecting}
                  onPress={() => void connect(async () => model.create!(platform.transports))}
                />
              </ListItem>
            );
          })}
        </Section>
      ) : null}
    </Screen>
  );
}
