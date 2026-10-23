import { useLocalSearchParams } from 'expo-router';
import { Button, Choice, ListItem, Muted, Screen, Section, Toggle } from '../components/ui';
import {
  CONTENTS,
  CORRIDORS,
  DEFAULT_OPTIONS,
  DETAILS,
  type Corridor,
  type Detail,
  type MapContent,
  type SendOptions as Options,
} from '../lib/mapPlan';
import { setOptions, useMapPlan, useSendOptions } from '../lib/mapSend';
import { useApp } from '../lib/store';
import { corridor, mapText } from './mapText';
import { useRoute } from './useRoute';

const DETAIL_CHOICES: { value: Options['detail']; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  ...(Object.keys(DETAILS) as Detail[]).map((d) => ({ value: d, label: DETAILS[d].label })),
  { value: 'custom', label: 'Personnalisé' },
];

/** What goes with a route (advanced): the background map's detail and corridor. */
export default function SendOptions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { device } = useApp();
  const { route, analysis } = useRoute(id);
  const o = useSendOptions();
  const [map, retryMap] = useMapPlan(id, route, analysis, device);
  const shown = mapText(map, o);
  const set = (patch: Partial<Options>) => setOptions({ ...o, ...patch });
  const toggle = (c: MapContent, on: boolean) =>
    set({ contents: (Object.keys(CONTENTS) as MapContent[]).filter((k) => (k === c ? on : o.contents.includes(k))) });

  return (
    <Screen title="Options d’envoi">
      <Section title="Envoyer">
        <Toggle
          label="Le fond de carte"
          value={o.map}
          onChange={(map) => set({ map })}
          help="La trace part toujours : la carte est faite pour elle."
        />
      </Section>

      {o.map ? (
        <Section title="Fond de carte">
          <Choice
            label="Détail"
            value={o.detail}
            options={DETAIL_CHOICES}
            onChange={(v) => set({ detail: v as Options['detail'] })}
            help={o.detail === 'auto' ? 'Le plus riche qui tient sur le compteur.' : undefined}
          />
          <Choice
            label="Couloir autour de la trace"
            value={String(o.corridorM)}
            options={CORRIDORS.map((m) => ({ value: String(m), label: corridor(m) }))}
            onChange={(v) => set({ corridorM: Number(v) as Corridor })}
            help={o.detail === 'auto' ? 'Réduit à 500 m si la carte ne tient pas en essentiel.' : undefined}
          />
        </Section>
      ) : null}

      {o.map && o.detail === 'custom' ? (
        <Section title="Contenu">
          {(Object.keys(CONTENTS) as MapContent[]).map((c) => (
            <Toggle key={c} label={CONTENTS[c].label} value={o.contents.includes(c)} onChange={(on) => toggle(c, on)} />
          ))}
        </Section>
      ) : null}

      <Section title="Pour cette trace">
        {shown ? (
          <ListItem title={shown.title} detail={shown.detail}>
            {map.status === 'failed' ? <Button label="Réessayer" variant="secondary" onPress={retryMap} /> : null}
          </ListItem>
        ) : (
          <Muted>{device ? 'Pas de fond de carte : la trace part seule.' : 'Connectez un compteur pour voir la taille de la carte.'}</Muted>
        )}
      </Section>

      {JSON.stringify(o) !== JSON.stringify(DEFAULT_OPTIONS) ? (
        <Section>
          <Button label="Revenir au réglage automatique" variant="secondary" onPress={() => setOptions(DEFAULT_OPTIONS)} />
        </Section>
      ) : null}
    </Screen>
  );
}
