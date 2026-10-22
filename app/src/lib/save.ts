import type { FileSaver } from './save.types';

export type { FileSaver } from './save.types';

/** iOS: none, the share sheet already offers "Save to Files" (Android: `save.android.ts`, web: `save.web.ts`). */
export const fileSaver: FileSaver | undefined = undefined;
