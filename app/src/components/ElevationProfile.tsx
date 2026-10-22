import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { RouteAnalysis } from '../lib/core';
import { theme } from '../theme';

const W = 600;
const H = 120;

function profilePath(profile: number[]): string {
  if (profile.length < 2) return '';
  const min = Math.min(...profile);
  const max = Math.max(...profile);
  const sy = (e: number) => H - ((e - min) / Math.max(max - min, 1)) * (H - 10) - 5;
  return profile
    .map((e, i) => `${i ? 'L' : 'M'}${((i / (profile.length - 1)) * W).toFixed(1)} ${sy(e).toFixed(1)}`)
    .join(' ');
}

/** The elevation profile of a route or a ride, its climbs as bands; nothing without elevation. */
export function ElevationProfile({ analysis }: { analysis: RouteAnalysis }) {
  const path = useMemo(() => profilePath(analysis.profile), [analysis]);
  if (!path) return null;
  return (
    <View style={{ width: '100%', aspectRatio: W / H }} accessibilityLabel="Profil d’altitude">
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {analysis.climbs.map((c) => (
          <Rect
            key={c.startM}
            x={(c.startM / analysis.distanceM) * W}
            width={((c.endM - c.startM) / analysis.distanceM) * W}
            y={0}
            height={H}
            fill={theme.climb}
          />
        ))}
        <Path d={path} stroke={theme.accent} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}
