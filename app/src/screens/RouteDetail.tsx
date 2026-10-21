import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { MapPreview } from '../components/MapPreview';
import { Body, Button, Embed, ListItem, Muted, Screen, Section } from '../components/ui';
import { confirmAction } from '../lib/ask';
import { loadCore, type ParsedRoute, type RouteAnalysis } from '../lib/core';
import { parseGpx } from '../lib/gpx';
import { routeMapData } from '../lib/routeMap';
import { routes } from '../lib/storage';
import { reportError, useApp } from '../lib/store';
import { theme } from '../theme';
import { km, pct } from './format';

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

/** One route of the library: profile, climbs, send to the device, delete. */
export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { device } = useApp();
  const [route, setRoute] = useState<ParsedRoute>();
  const [analysis, setAnalysis] = useState<RouteAnalysis>();
  const [missing, setMissing] = useState(false);
  /** Share of the route the device holds while sending, undefined otherwise. */
  const [sending, setSending] = useState<number>();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await routes.get(id);
        if (!stored) return setMissing(true);
        const parsed = await parseGpx(stored.gpx);
        setAnalysis((await loadCore()).analyzeRoute(parsed.lats, parsed.lons, parsed.eles));
        setRoute(parsed);
      } catch (e) {
        reportError(e);
      }
    })();
  }, [id]);

  const path = useMemo(() => (analysis ? profilePath(analysis.profile) : ''), [analysis]);
  const mapData = useMemo(() => (route && analysis ? routeMapData(route, analysis) : undefined), [route, analysis]);
  const canSend = !!device?.capabilities.uploadRoute && !!device?.uploadRoute;

  async function send() {
    if (!device?.uploadRoute || !route) return;
    if (!(await confirmAction(`Remplacer la trace du compteur par « ${route.name} » ?`, 'Remplacer'))) return;
    setSending(0);
    setSent(false);
    try {
      await device.uploadRoute(route, setSending);
      setSent(true);
    } catch (e) {
      reportError(e);
    } finally {
      setSending(undefined);
    }
  }

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
        {path ? (
          <Embed>
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
          </Embed>
        ) : null}
      </Section>

      {analysis.climbs.length > 0 ? (
        <Section title="Montées détectées">
          {analysis.climbs.map((c, i) => (
            <ListItem
              key={c.startM}
              title={`${i + 1}. km ${km(c.startM)} · ${km(c.endM - c.startM)} km · ${pct(c.avgGrade)} %`}
              detail={`+${Math.round(c.gainM)} m · max ${pct(c.maxGrade)} % · ${c.category === 'uncategorized' ? 'non classée' : `cat. ${c.category}`}`}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Compteur">
        <Button
          label={sending !== undefined ? `Envoi… ${Math.round(sending * 100)} %` : 'Envoyer sur le compteur'}
          disabled={!canSend || sending !== undefined}
          onPress={() => void send()}
        />
        {sent ? <Body>Trace envoyée sur le compteur.</Body> : null}
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
