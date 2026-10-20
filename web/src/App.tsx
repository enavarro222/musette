import { useEffect, useState } from 'react';
import { appStore, useApp } from './lib/store';
import Activities from './screens/Activities';
import Devices from './screens/Devices';
import Project from './screens/Project';
import Routes from './screens/Routes';

type Tab = 'devices' | 'activities' | 'routes' | 'project';
const TABS: { id: Tab; label: string }[] = [
  { id: 'devices', label: 'Compteur' },
  { id: 'activities', label: 'Sorties' },
  { id: 'routes', label: 'Traces' },
  { id: 'project', label: 'Projet' },
];

export default function App() {
  const { error, pendingRoute } = useApp();
  const [tab, setTab] = useState<Tab>('devices');

  useEffect(() => {
    if (pendingRoute) setTab('routes');
  }, [pendingRoute]);

  return (
    <>
      <main>
        {tab === 'devices' && <Devices onSynced={() => setTab('activities')} />}
        {tab === 'activities' && <Activities />}
        {tab === 'routes' && <Routes />}
        {tab === 'project' && <Project />}
      </main>

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => appStore.set({ error: undefined })}>
            OK
          </button>
        </div>
      )}

      <nav aria-label="Navigation principale">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : undefined}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
