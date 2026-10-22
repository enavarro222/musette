import type { ClimbInfo } from '../lib/core';
import { km, pct } from '../screens/format';
import { ListItem, Section } from './ui';

/** The climbs of a route or a ride, in order; nothing without climbs. */
export function ClimbList({ climbs }: { climbs: ClimbInfo[] }) {
  if (climbs.length === 0) return null;
  return (
    <Section title="Montées détectées">
      {climbs.map((c, i) => (
        <ListItem
          key={c.startM}
          title={`${i + 1}. km ${km(c.startM)} · ${km(c.endM - c.startM)} km · ${pct(c.avgGrade)} %`}
          detail={`+${Math.round(c.gainM)} m · max ${pct(c.maxGrade)} % · ${c.category === 'uncategorized' ? 'non classée' : `cat. ${c.category}`}`}
        />
      ))}
    </Section>
  );
}
