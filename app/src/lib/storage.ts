/**
 * iOS and Android: local storage of activities, as files in the app's
 * documents (backed up by the OS, never sent anywhere by Musette).
 * Same API as `storage.web.ts`.
 *
 * Each ride is `<key>.fit` and `<key>.json` (the rest of `StoredActivity`).
 * The JSON is written last: a ride without it was not stored (the app
 * stopped in between) and is downloaded again.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { newestFirst, type ActivityStore, type StoredActivity } from './storage.types';

export type { StoredActivity } from './storage.types';

type Meta = Omit<StoredActivity, 'fit'>;

const rides = () => {
  const dir = new Directory(Paths.document, 'rides');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
};

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
  async all() {
    const metas = rides()
      .list()
      .filter((f): f is File => f instanceof File && f.name.endsWith('.json'));
    const list = await Promise.all(
      metas.map(async (f) => {
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

/** Offer a file to the user (OS share sheet: save, send to an app…). */
export async function shareFile(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<void> {
  const file = new File(Paths.cache, name);
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: name });
}
