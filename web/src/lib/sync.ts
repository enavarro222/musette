import type { ActivityRef, Device } from './devices/types';
import { activities } from './storage';

function fileName(device: Device, ref: ActivityRef): string {
  const base = ref.id.split('/').pop() ?? ref.id;
  if (base.toLowerCase().endsWith('.fit')) return base;
  const date = ref.startTime ? new Date(ref.startTime * 1000).toISOString().slice(0, 16).replace(/[:T]/g, '-') : ref.id;
  return `${device.model}-${date}.fit`;
}

/**
 * Copy new activities from the device to local storage.
 *
 * Order matters (rides must never be lost): download → integrity check
 * (inside the driver) → store → only then acknowledge to the device.
 */
export async function syncActivities(device: Device, onStatus: (msg: string) => void): Promise<number> {
  onStatus('Lecture de la liste des sorties…');
  const refs = await device.listActivities();
  const todo: ActivityRef[] = [];
  for (const ref of refs) {
    if (!(await activities.has(`${device.model}:${ref.id}`))) todo.push(ref);
  }
  for (const [i, ref] of todo.entries()) {
    const fit = await device.downloadActivity(ref, (r) =>
      onStatus(`Sortie ${i + 1}/${todo.length} — ${Math.round(r * 100)} %`),
    );
    await activities.put({
      key: `${device.model}:${ref.id}`,
      model: device.model,
      deviceName: device.name,
      startTime: ref.startTime,
      importedAt: Date.now(),
      fileName: fileName(device, ref),
      fit,
    });
    await device.acknowledgeActivity?.(ref, fit);
  }
  onStatus(todo.length ? `${todo.length} sortie(s) récupérée(s)` : 'Aucune nouvelle sortie');
  return todo.length;
}
