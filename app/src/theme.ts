/** Musette's colours. Native components keep their platform look (SwiftUI, Material 3), tinted with `accent`. */
export const theme = {
  accent: '#0B6E69',
  /** Secondary text, readable on light and dark backgrounds. */
  muted: '#8A8F96',
  danger: '#C0392B',
  /** Climb bands on the elevation profile. */
  climb: 'rgba(194, 112, 31, 0.22)',
  /** Climbs drawn on the map, over the route. */
  climbLine: '#C2701F',
} as const;
