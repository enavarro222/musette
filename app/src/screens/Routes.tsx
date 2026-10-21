import { Button, Column, FieldGroup, RNHostView, Text } from '@expo/ui';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Muted } from '../components/Muted';
import { confirmAction } from '../lib/ask';
import { loadCore, type ParsedRoute, type RouteAnalysis } from '../lib/core';
import { pickGpx } from '../lib/files';
import { parseGpx } from '../lib/gpx';
import { appStore, reportError, useApp } from '../lib/store';
import { theme } from '../theme';

const W = 600;
const H = 120;
const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (g: number) => (g * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function profilePath(profile: number[]): string {
  if (profile.length < 2) return '';
  const min = Math.min(...profile);
  const max = Math.max(...profile);
  const sy = (e: number) => H - ((e - min) / Math.max(max - min, 1)) * (H - 10) - 5;
  return profile
    .map((e, i) => `${i ? 'L' : 'M'}${((i / (profile.length - 1)) * W).toFixed(1)} ${sy(e).toFixed(1)}`)
    .join(' ');
}

export default function Routes() {
  const { device, pendingRoute } = useApp();
  const [route, setRoute] = useState<ParsedRoute>();
  const [analysis, setAnalysis] = useState<RouteAnalysis>();
  /** Share of the route the device holds while sending, undefined otherwise. */
  const [sending, setSending] = useState<number>();
  const [sent, setSent] = useState(false);

  async function load(text: string) {
    try {
      const parsed = await parseGpx(text);
      const core = await loadCore();
      setAnalysis(core.analyzeRoute(parsed.lats, parsed.lons, parsed.eles));
      setRoute(parsed);
      setSent(false);
    } catch (e) {
      reportError(e);
    }
  }

  async function open() {
    try {
      const text = await pickGpx();
      if (text !== undefined) await load(text);
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    if (pendingRoute) {
      appStore.set({ pendingRoute: undefined });
      void load(pendingRoute);
    }
  }, [pendingRoute]);

  const path = useMemo(() => (analysis ? profilePath(analysis.profile) : ''), [analysis]);
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

  return (
    <Screen>
      <FieldGroup.Section title="Traces">
        <Button label="Ouvrir un fichier GPX" onPress={() => void open()} />
        <Muted>Exporté depuis Komoot, Openrunner ou un autre outil.</Muted>
      </FieldGroup.Section>

      {route && analysis ? (
        <>
          <FieldGroup.Section title={route.name}>
            <Text>
              {`${km(analysis.distanceM)} km · ${Math.round(analysis.ascentM)} m D+ · ${analysis.climbs.length} montée(s)`}
            </Text>
            {path ? (
              <RNHostView matchContents={{ vertical: true }}>
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
              </RNHostView>
            ) : null}
          </FieldGroup.Section>

          {analysis.climbs.length > 0 ? (
            <FieldGroup.Section title="Montées détectées">
              {analysis.climbs.map((c, i) => (
                <Column key={c.startM} spacing={2} alignment="start">
                  <Text>{`${i + 1}. km ${km(c.startM)} · ${km(c.endM - c.startM)} km · ${pct(c.avgGrade)} %`}</Text>
                  <Muted>{`+${Math.round(c.gainM)} m · max ${pct(c.maxGrade)} % · cat. ${c.category}`}</Muted>
                </Column>
              ))}
            </FieldGroup.Section>
          ) : null}

          <FieldGroup.Section>
            <Button
              label={sending !== undefined ? `Envoi… ${Math.round(sending * 100)} %` : 'Envoyer sur le compteur'}
              disabled={!canSend || sending !== undefined}
              onPress={() => void send()}
            />
            {sent ? <Text>Trace envoyée sur le compteur.</Text> : null}
            {!device ? (
              <Muted>Connectez un compteur pour envoyer la trace.</Muted>
            ) : !canSend ? (
              <Muted>L’envoi de trace n’est pas encore disponible pour ce compteur.</Muted>
            ) : null}
          </FieldGroup.Section>
        </>
      ) : null}
    </Screen>
  );
}
