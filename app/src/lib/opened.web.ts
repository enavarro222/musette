import { appStore } from './store';

// PWA file handler: "Open with Musette" on a .gpx file (desktop Chrome).
type LaunchQueue = { setConsumer(cb: (p: { files: { getFile(): Promise<File> }[] }) => void): void };

/** Routes the OS hands to the app go to `pendingRoute`. */
export function listenForOpenedRoutes(): () => void {
  const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  lq?.setConsumer(async (params) => {
    if (params.files[0]) appStore.set({ pendingRoute: await (await params.files[0].getFile()).text() });
  });
  return () => {};
}
