import { useState } from 'react';
import { MODELS, type ModelEntry } from '../lib/devices/registry';
import { appStore, reportError, useApp } from '../lib/store';
import { syncActivities } from '../lib/sync';

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
  const { device, platform, connecting } = useApp();
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function connect(model: ModelEntry) {
    const d = model.create(platform!.transports);
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

  return (
    <>
      <h1>Mon compteur</h1>

      {device ? (
        <>
          <section className="card">
            <div className="row">
              <div className="grow">
                <div className="title">{device.name}</div>
                <span className="pill">Connecté</span>
              </div>
              <button type="button" className="secondary" onClick={disconnect}>
                Déconnecter
              </button>
            </div>
            <ul className="chips">
              {Object.entries(device.capabilities)
                .filter(([, on]) => on)
                .map(([key]) => (
                  <li key={key}>{CAPABILITY_LABELS[key] ?? key}</li>
                ))}
            </ul>
          </section>

          {device.capabilities.downloadActivities && (
            <section className="card accent">
              <div className="title">Sorties</div>
              <p className="muted">Copiées sur cet appareil, vérifiées, puis signalées au compteur.</p>
              <button type="button" className="primary" disabled={syncing} onClick={sync}>
                {syncing ? 'Récupération…' : 'Récupérer les sorties'}
              </button>
              {status && (
                <p className="muted" aria-live="polite">
                  {status}
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Choisissez votre compteur. Dans le navigateur, il faut le resélectionner à chaque visite.
          </p>
          <section className="card list">
            {MODELS.map((model) => {
              const supported = !!platform && !!model.create(platform.transports);
              return (
                <div className="row" key={model.id}>
                  <div className="grow">
                    <div className="title">{model.label}</div>
                    <div className="muted small">
                      {supported
                        ? model.connectHint
                        : 'Non pris en charge par ce navigateur (essayez Chrome ou Edge sur ordinateur).'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={!supported || connecting}
                    onClick={() => connect(model)}
                  >
                    Connecter
                  </button>
                </div>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}
