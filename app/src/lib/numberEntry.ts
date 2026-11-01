/** Optional numeric settings use an empty field for the device's unset value. */
export interface NumberEntryOptions {
  emptyValue?: number;
  placeholder?: string;
}

export function numberEntryText(value: number, options: NumberEntryOptions): string {
  return value === options.emptyValue ? '' : String(value);
}

/** Validate a completed draft; partial input must never reach the device. */
export function parseNumberEntry(text: string, min: number, max: number, step: number, options: NumberEntryOptions):
  { value: number; error?: never } | { value?: never; error: string } {
  const trimmed = text.trim();
  if (!trimmed && options.emptyValue !== undefined) return { value: options.emptyValue };
  const value = trimmed ? Number(trimmed.replace(',', '.')) : NaN;
  if (!Number.isFinite(value) || !/^\d+(?:[.,]\d+)?$/.test(trimmed)) return { error: 'Saisis une valeur numérique.' };
  if (value < min || value > max) return { error: `La valeur doit être comprise entre ${min} et ${max}.` };
  const steps = (value - min) / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-7) return { error: step === 1 ? 'Saisis un nombre entier.' : `Utilise un pas de ${step}.` };
  return { value };
}
