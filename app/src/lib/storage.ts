/**
 * iOS and Android: local storage of rides and routes, as files in the app's
 * documents (backed up by the OS, never sent anywhere by Musette).
 * Same API as `storage.web.ts`.
 *
 * Each ride is `rides/<key>.fit` and `rides/<key>.json` (the rest of
 * `StoredActivity`); each route `routes/<id>.gpx` and `routes/<id>.json`.
 * The JSON is written last: an item without it was not stored (the app
 * stopped in between); a ride is then downloaded again.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  newestFirst,
  type ActivityStore,
  type RouteStore,
  type StoredActivity,
  type StoredRoute,
} from './storage.types';

export type { RouteSummary, StoredActivity, StoredRoute } from './storage.types';
export { newRouteId } from './storage.types';

type Meta = Omit<StoredActivity, 'fit'>;
type RouteMeta = Omit<StoredRoute, 'gpx'>;

function folder(name: string): Directory {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const rides = () => folder('rides');

const metas = (dir: Directory) =>
  dir.list().filter((f): f is File => f instanceof File && f.name.endsWith('.json'));

/** Keys hold `:` and `/`, file names cannot. */
const base = (key: string) => encodeURIComponent(key);
const fitFile = (key: string) => new File(rides(), `${base(key)}.fit`);
const metaFile = (key: string) => new File(rides(), `${base(key)}.json`);

export const activities: ActivityStore = {
  async put(a) {
    const { fit, ...meta } = a;
    await fitFile(a.key).write(fit);
    await metaFile(a.key).write(JSON.stringify(meta));
  },
  has: async (key) => metaFile(key).exists,
  async get(key) {
    const meta = metaFile(key);
    if (!meta.exists) return undefined;
    return { ...(JSON.parse(await meta.text()) as Meta), fit: await fitFile(key).bytes() };
  },
  async setSummary(key, summary) {
    const meta = metaFile(key);
    if (!meta.exists) return;
    await meta.write(JSON.stringify({ ...(JSON.parse(await meta.text()) as Meta), summary }));
  },
  async all() {
    const list = await Promise.all(
      metas(rides()).map(async (f) => {
        const meta = JSON.parse(await f.text()) as Meta;
        return { ...meta, fit: await fitFile(meta.key).bytes() };
      }),
    );
    return newestFirst(list);
  },
  async remove(key) {
    for (const f of [metaFile(key), fitFile(key)]) if (f.exists) f.delete();
  },
};

const routeGpx = (id: string) => new File(folder('routes'), `${base(id)}.gpx`);
const routeMeta = (id: string) => new File(folder('routes'), `${base(id)}.json`);

export const routes: RouteStore = {
  async put(r) {
    const { gpx, ...meta } = r;
    await routeGpx(r.id).write(gpx);
    await routeMeta(r.id).write(JSON.stringify(meta));
  },
  async get(id) {
    const meta = routeMeta(id);
    if (!meta.exists) return undefined;
    return { ...(JSON.parse(await meta.text()) as RouteMeta), gpx: await routeGpx(id).text() };
  },
  async all() {
    // The list needs no GPX: it stays on disk until a route is opened.
    const list = await Promise.all(metas(folder('routes')).map(async (f) => JSON.parse(await f.text()) as RouteMeta));
    return list.sort((a, b) => b.importedAt - a.importedAt);
  },
  async remove(id) {
    for (const f of [routeMeta(id), routeGpx(id)]) if (f.exists) f.delete();
  },
};

/** Offer a file to the user (OS share sheet: save, send to an app…). */
export async function shareFile(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<void> {
  const file = new File(Paths.cache, name);
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: name });
}
