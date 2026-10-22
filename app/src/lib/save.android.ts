/**
 * Android: the share sheet offers no "save to Downloads", so files are
 * written in a folder the user picks once (system folder picker, Storage
 * Access Framework). Android keeps the app's access to it; its address is
 * kept in the app's documents.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { FileSaver } from './save.types';

export type { FileSaver } from './save.types';

const remembered = () => new File(Paths.document, 'save-folder.txt');

/** `content://…/tree/primary%3ADownload%2FVelo` → `Download/Velo`. */
function folderName(uri: string): string {
  const path = decodeURIComponent(uri.split('/tree/').pop() ?? uri);
  return path.slice(path.indexOf(':') + 1) || path;
}

async function pick(): Promise<Directory | undefined> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    await remembered().write(dir.uri);
    return dir;
  } catch (e) {
    if (e instanceof Error && e.message.includes('cancelled')) return undefined;
    throw e;
  }
}

export const fileSaver: FileSaver = {
  label: 'Enregistrer sur le téléphone',
  async folder() {
    const f = remembered();
    return f.exists ? folderName(await f.text()) : undefined;
  },
  async save(name, bytes, choose = false) {
    const f = remembered();
    let dir = !choose && f.exists ? new Directory(await f.text()) : undefined;
    let file: File | undefined;
    try {
      // `octet-stream`: Android keeps the name as is (no extension added for an unknown type).
      file = dir?.createFile(name, 'application/octet-stream');
    } catch {
      // The folder is gone, or Android no longer lets the app in: ask again.
      dir = undefined;
    }
    if (!dir || !file) {
      dir = await pick();
      if (!dir) return undefined;
      file = dir.createFile(name, 'application/octet-stream');
    }
    await file.write(bytes);
    return folderName(dir.uri);
  },
};
