import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';
import { webPlatform, type MusettePlatform } from './lib/platform';
import { appStore } from './lib/store';

/** Mount Musette into `target` with the given platform (web by default). */
export function mountMusette(target: HTMLElement, platform: MusettePlatform = webPlatform) {
  appStore.set({ platform });
  const root = createRoot(target);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return root;
}

// PWA file handler: "Open with Musette" on a .gpx file (desktop Chrome).
type LaunchQueue = { setConsumer(cb: (p: { files: { getFile(): Promise<File> }[] }) => void): void };
const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
lq?.setConsumer(async (params) => {
  if (params.files[0]) appStore.set({ pendingRoute: await params.files[0].getFile() });
});

mountMusette(document.getElementById('app')!);
