import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(a: StoredActivity) {
    if (!confirm(`Supprimer « ${a.fileName} » de cet appareil ? Cette action est définitive.`)) return;
    await activities.remove(a.key).catch(reportError);
    await refresh();
  }

  return (
    <>
      <h1>Sorties</h1>
      <p className="muted">Fichiers FIT stockés dans ce navigateur.</p>

      {list.length === 0 ? (
        <section className="card">
          <p className="muted">Aucune sortie pour l’instant. Connectez un compteur pour les récupérer.</p>
        </section>
      ) : (
        <section className="card list">
          {list.map((a) => (
            <div className="row" key={a.key}>
              <div className="grow">
                <div className="title">{fmt.format(when(a))}</div>
                <div className="muted small">
                  {a.deviceName} · {(a.fit.byteLength / 1024).toFixed(0)} Ko
                </div>
              </div>
              <button type="button" className="secondary" onClick={() => shareFile(a.fileName, a.fit).catch(reportError)}>
                FIT
              </button>
              <button type="button" className="ghost" aria-label="Supprimer" onClick={() => remove(a)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
