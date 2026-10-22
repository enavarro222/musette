import type { FileSaver } from './save.types';

export type { FileSaver } from './save.types';

/** Web: a download, in the browser's own folder. */
export const fileSaver: FileSaver = {
  label: 'Télécharger',
  folder: async () => undefined,
  async save(name, bytes) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'Téléchargements';
  },
};
