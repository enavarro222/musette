/** Kilometres, French style, one decimal. */
export const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** A grade (0.056) as a percentage (5,6). */
export const pct = (g: number) => (g * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
