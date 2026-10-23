import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ClimbList } from '../components/ClimbList';
import { ElevationProfile } from '../components/ElevationProfile';
import { MapPreview } from '../components/MapPreview';
import { Body, Button, Embed, LinkItem, ListItem, Muted, Screen, Section, Toggle } from '../components/ui';
import { confirmAction } from '../lib/ask';
import { sendRouteAndMap, setOptions, useMapPlan, useSendOptions, type Sending } from '../lib/mapSend';
import { routeMapData } from '../lib/routeMap';
import { routes } from '../lib/storage';
import { reportError, useApp } from '../lib/store';
import { km, size } from './format';
import { mapText } from './mapText';
import { useRoute } from './useRoute';

/** One route of the library: profile, climbs, send to the device, delete. */
export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { device } = useApp();
  const { route, analysis, missing } = useRoute(id);
  /** What the device holds while sending, undefined otherwise. */
  const [sending, setSending] = useState<Sending>();
  const [sent, setSent] = useState<string>();
  const options = useSendOptions();

  const mapData = useMemo(() => (route && analysis ? routeMapData(route, analysis) : undefined), [route, analysis]);
  const canSend = !!device?.capabilities.uploadRoute && !!device?.uploadRoute;
  const draws = !!device?.capabilities.routeCorridorMap;
  const [map, retryMap] = useMapPlan(id, route, analysis, device);
  const shownMap = mapText(map, options);

  async function send() {
    if (!device || !route) return;
    if (!(await confirmAction(`Remplacer la trace du compteur par « ${route.name} » ?`, 'Remplacer'))) return;
    setSending({ what: 'route', ratio: 0 });
    setSent(undefined);
    try {
      const sentMap = await sendRouteAndMap(device, route, map, setSending);
      setSent(
        !sentMap
          ? 'Trace envoyée sur le compteur.'
          : map.status === 'ready' && sentMap !== map.plan
            ? `Trace et fond de carte envoyés (carte allégée à ${size(sentMap.bytes.length)} : la trace a pris de la place).`
            : 'Trace et fond de carte envoyés sur le compteur.',
      );
    } catch (e) {
      reportError(e);
    } finally {
      setSending(undefined);
    }
  }

  const sendLabel = !sending
    ? 'Envoyer sur le compteur'
    : `Envoi ${sending.what === 'map' ? 'de la carte' : 'de la trace'}… ${Math.round(sending.ratio * 100)} %`;

  async function remove() {
    if (!route || !(await confirmAction(`Supprimer « ${route.name} » de cet appareil ?`, 'Supprimer'))) return;
    await routes.remove(id).catch(reportError);
    router.back();
  }

  if (missing) {
    return (
      <Screen title="Trace">
        <Section>
          <Muted>Cette trace n’est plus sur cet appareil.</Muted>
        </Section>
      </Screen>
    );
  }
  if (!route || !analysis) {
    return (
      <Screen title="Trace">
        <Section>
          <Muted>Lecture de la trace…</Muted>
        </Section>
      </Screen>
    );
  }

  return (
    <Screen title={route.name}>
      <Section>
        <Body>
          {`${km(analysis.distanceM)} km · ${Math.round(analysis.ascentM)} m D+ · ${analysis.climbs.length} montée(s)`}
        </Body>
        {mapData ? (
          <Embed>
            <MapPreview data={mapData} onOpen={() => router.push(`/routes/${id}/map`)} />
          </Embed>
        ) : null}
        {analysis.profile.length > 1 ? (
          <Embed>
            <ElevationProfile analysis={analysis} />
          </Embed>
        ) : null}
      </Section>

      <ClimbList climbs={analysis.climbs} />

      <Section title="Compteur">
        {canSend && draws ? (
          <Toggle label="Fond de carte" value={options.map} onChange={(v) => setOptions({ ...options, map: v })} />
        ) : null}
        {shownMap ? (
          <ListItem title={shownMap.title} detail={shownMap.detail}>
            {map.status === 'failed' ? <Button label="Réessayer" variant="secondary" onPress={retryMap} /> : null}
          </ListItem>
        ) : null}
        <Button
          label={sendLabel}
          disabled={!canSend || !!sending || map.status === 'preparing'}
          onPress={() => void send()}
        />
        {map.status === 'preparing' && !sending ? (
          <Button label="Envoyer la trace seule" variant="secondary" onPress={() => void send()} />
        ) : null}
        {sent ? <Body>{sent}</Body> : null}
        {canSend && draws ? (
          <LinkItem title="Options d’envoi" onPress={() => router.push(`/routes/${id}/options`)} />
        ) : null}
        {!device ? (
          <Muted>Connectez un compteur pour lui envoyer la trace.</Muted>
        ) : !canSend ? (
          <Muted>L’envoi de trace n’est pas encore disponible pour ce compteur.</Muted>
        ) : null}
      </Section>

      <Section>
        <Button label="Supprimer la trace" variant="danger" onPress={() => void remove()} />
      </Section>
    </Screen>
  );
}
