import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { app } from './lib/state.svelte';
import { webPlatform, type MusettePlatform } from './lib/platform';

/** Mount Musette into `target` with the given platform (web by default). */
export function mountMusette(target: HTMLElement, platform: MusettePlatform = webPlatform) {
  app.platform = platform;
  return mount(App, { target });
}

// PWA file handler: "Open with Musette" on a .gpx file (desktop Chrome).
type LaunchQueue = { setConsumer(cb: (p: { files: { getFile(): Promise<File> }[] }) => void): void };
const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
lq?.setConsumer(async (params) => {
  if (params.files[0]) app.pendingRoute = await params.files[0].getFile();
});

mountMusette(document.getElementById('app')!);
