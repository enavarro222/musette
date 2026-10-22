/** Kilometres, French style, one decimal. */
export const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** A grade (0.056) as a percentage (5,6). */
export const pct = (g: number) => (g * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** A duration: `2 h 05` or `42 min`. */
export const duration = (s: number) => {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

/** A speed (m/s) in km/h, one decimal. */
export const kmh = (mps: number) => (mps * 3.6).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
