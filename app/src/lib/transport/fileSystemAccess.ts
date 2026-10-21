import type { DriveFile, FileTransport } from './types';

// Minimal typings: the File System Access API is not in lib.dom yet.
interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirHandle>;
};

/**
 * Reads a device mounted as USB mass storage (e.g. Bryton Rider 750) via the
 * File System Access API. Desktop Chrome/Edge only (the mobile app does not
 * read USB drives yet).
 */
export class FileSystemAccessTransport implements FileTransport {
  readonly kind = 'files' as const;
  rootName?: string;
  private root?: DirHandle;

  constructor(private readonly mode: 'read' | 'readwrite' = 'read') {}

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  async connect(): Promise<void> {
    const w = window as PickerWindow;
    if (!w.showDirectoryPicker) {
      throw new Error("Accès aux dossiers indisponible dans ce navigateur (essayez Chrome sur ordinateur).");
    }
    this.root = await w.showDirectoryPicker({ mode: this.mode, id: 'musette-device' });
    this.rootName = this.root.name;
  }

  async disconnect(): Promise<void> {
    this.root = undefined;
  }

  async list(): Promise<DriveFile[]> {
    const root = this.requireRoot();
    const out: DriveFile[] = [];
    const walk = async (dir: DirHandle, prefix: string, depth: number) => {
      if (depth > 6) return;
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          await walk(entry, path, depth + 1);
        } else {
          const file = await entry.getFile();
          out.push({ path, size: file.size });
        }
      }
    };
    await walk(root, '', 0);
    return out;
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.resolveFile(path, false);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (this.mode !== 'readwrite') throw new Error('Dossier ouvert en lecture seule');
    const handle = await this.resolveFile(path, true);
    const w = await handle.createWritable();
    await w.write(new Uint8Array(bytes));
    await w.close();
  }

  private async resolveFile(path: string, create: boolean): Promise<FileHandle> {
    let dir = this.requireRoot();
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`Chemin invalide : ${path}`);
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return dir.getFileHandle(name, { create });
  }

  private requireRoot(): DirHandle {
    if (!this.root) throw new Error('Aucun dossier sélectionné');
    return this.root;
  }
}
