import { useEffect, useRef, useState } from 'react';
import { AtlasArea } from '../components/AtlasArea';
import { AtlasPreview } from '../components/AtlasPreview';
import { Body, Button, Choice, Embed, Muted, Screen, Section, Toggle } from '../components/ui';
import { ATLAS_ZONES, DEFAULT_ATLAS, atlasSelection, readAtlasOptions, sendAtlas, type AtlasOptions } from '../lib/atlas';
import { atlasBoundsKey, type AtlasBounds } from '../lib/atlasGeometry';
import { ATLAS_BUDGET, prepareGlobalAtlas, type AtlasPlan } from '../lib/atlasPlan';
import type { AtlasProgress } from '../lib/atlasOsm';
import { atlasSource } from '../lib/atlasSource';
import { atlasPreviewData, type AtlasPreviewData } from '../lib/atlasPreview';
import { confirmAction } from '../lib/ask';
import { prefs } from '../lib/storage';
import { reportError, useApp } from '../lib/store';

const atlasSize = (bytes: number) => `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Kio`;

/** One permanent geographic selection, prepared to fit the device's actual budget. */
export default function GlobalMap() {
  const { device } = useApp();
  const [options, setOptions] = useState<AtlasOptions>();
  const [prepared, setPrepared] = useState<{ options: AtlasOptions; plan: AtlasPlan; preview: AtlasPreviewData }>();
  const [progress, setProgress] = useState<AtlasProgress>();
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState<number>();
  const [sent, setSent] = useState(false);
  const [areaFrame, setAreaFrame] = useState(0);
  const [installed, setInstalled] = useState<{ device: typeof device; bytes?: number }>();
  const pending = useRef<AbortController | undefined>(undefined);
  const busy = preparing || sending !== undefined;

  useEffect(() => {
    void prefs.get<AtlasOptions>('atlasOptions').then((o) => setOptions(readAtlasOptions(o)))
      .catch(() => setOptions(DEFAULT_ATLAS));
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    let live = true;
    void device?.refreshInfo?.().then(() => { if (live) setInstalled({ device, bytes: device.atlasBytes }); }).catch(reportError);
    return () => { live = false; };
  }, [device]);

  function change(patch: Partial<AtlasOptions>) {
    if (!options || busy) return;
    const next = { ...options, ...patch };
    setOptions(next); setSent(false);
    void prefs.set('atlasOptions', next).catch(reportError);
  }
  function zone(value: string) {
    if (!options) return;
    if (value === 'custom') change({ zone: 'custom', source: 'osm', bounds: options.bounds ?? atlasSelection(options).bounds });
    else change({ zone: value as AtlasOptions['zone'] });
  }
  function area(bounds: AtlasBounds) {
    if (options?.bounds && atlasBoundsKey(options.bounds) === atlasBoundsKey(bounds)) return;
    change({ bounds });
  }

  const plan = prepared?.options === options ? prepared?.plan : undefined;
  const present = installed?.device === device ? installed?.bytes : device?.atlasBytes;
  const limit = device?.fileLimits?.atlas;
  const budget = Math.min(limit ?? ATLAS_BUDGET, ATLAS_BUDGET);
  const room = `${Math.round(budget / 1024)} Kio`;
  const compatible = plan?.source !== 'osm' || (device?.atlasVersion ?? 0) >= 2;

  async function prepare() {
    if (!options || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setPreparing(true); setProgress(undefined); setSent(false);
    try {
      await device?.refreshInfo?.();
      const maximum = Math.min(device?.fileLimits?.atlas ?? ATLAS_BUDGET, ATLAS_BUDGET);
      const plan = await prepareGlobalAtlas(await atlasSource(options.zone), options, maximum, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (!controller.signal.aborted) {
        const preview = await atlasPreviewData(plan.bytes, atlasSelection(options).bounds);
        if (!controller.signal.aborted) setPrepared({ options, plan, preview });
      }
    } catch (e) {
      if (!controller.signal.aborted) reportError(e);
    } finally {
      if (pending.current === controller) { setPreparing(false); setProgress(undefined); pending.current = undefined; }
    }
  }
  async function send() {
    if (!device || !plan || !options || busy) return;
    const name = options.zone === 'custom' ? 'Zone personnelle' : ATLAS_ZONES[options.zone].label;
    if (!(await confirmAction(`Installer « ${name} » comme carte globale ? Elle remplacera la carte globale actuelle.`, 'Installer'))) return;
    setSending(0); setSent(false);
    try {
      await sendAtlas(device, plan.bytes, setSending, plan.source === 'osm' ? 2 : 1);
      setInstalled({ device, bytes: device.atlasBytes }); setSent(true);
    } catch (e) { reportError(e); }
    finally { setSending(undefined); }
  }

  const status = progress?.phase === 'download' ? `Lecture des données : ${progress.done}/${progress.total}…`
    : progress?.phase === 'compile' ? 'Adaptation du détail à la place disponible…' : 'Préparation de la carte…';

  return <Screen title="Carte globale">
    <Section title="Sur le compteur">
      <Body>Cette carte reste sur le compteur lorsque vous changez de trace. Elle apparaît sous le fond détaillé autour de la trace.</Body>
      <Muted>{!device ? 'Connectez un compteur pour voir la carte installée.' : present ? `${atlasSize(present)} installés sur le compteur.` : 'Aucune carte globale signalée sur ce compteur.'}</Muted>
    </Section>
    <Section title="Zone à installer">
      {options ? <>
        <Choice label="Zone" value={options.zone} options={[
          ...Object.entries(ATLAS_ZONES).map(([value, z]) => ({ value, label: z.label })),
          { value: 'custom', label: 'Choisir sur la carte…' },
        ]} onChange={zone} disabled={busy} />
        {options.zone === 'custom' ? <>
          <Body>Faites glisser les coins du rectangle pour régler sa largeur et sa hauteur, et sa poignée centrale pour déplacer la zone. Vous pouvez zoomer et déplacer la carte sans modifier la sélection.</Body>
          <Embed><AtlasArea initialBounds={options.bounds ?? [...ATLAS_ZONES.france.bounds] as AtlasBounds} fitRequest={areaFrame} onChange={area} disabled={busy} /></Embed>
          <Button label="Recentrer sur la sélection" variant="secondary" disabled={busy} onPress={() => setAreaFrame((n) => n + 1)} />
        </> : <Choice label="Données" value={options.source ?? 'osm'} options={[
          { value: 'osm', label: 'Détail automatique · OpenStreetMap' },
          { value: 'included', label: 'Fond inclus · données préchargées' },
        ]} onChange={(source) => change({ source: source as AtlasOptions['source'] })} disabled={busy} />}
        <Toggle label="Fleuves et lacs" value={options.rivers} onChange={(rivers) => change({ rivers })} disabled={busy} />
        <Toggle label="Villes et lieux" value={options.cities} onChange={(cities) => change({ cities })} disabled={busy} />
      </> : null}
      <Muted>{options?.source === 'included' && options.zone !== 'custom'
        ? 'Fond simplifié inclus dans Musette. Données Natural Earth · IGN / INSEE / Etalab ; régions sous ODbL.'
        : 'Une connexion Internet est nécessaire pour préparer une nouvelle zone. Les grands axes sont prioritaires ; routes secondaires, rues et chemins sont ajoutés selon la place disponible. © OpenStreetMap · OpenFreeMap · OpenMapTiles ; fond de contexte Natural Earth / Etalab, ODbL.'}</Muted>
    </Section>
    <Section title="Préparation et installation">
      <Body>{plan ? `${atlasSize(plan.bytes.length)} à envoyer · ${room} disponibles sur un budget séparé de 512 Kio.` : `Détail automatique pour utiliser au mieux les ${room} disponibles, sans réduire la zone choisie.`}</Body>
      {plan ? <>
        <Body>{plan.detail}</Body>
        {plan.reduced ? <Muted>Le détail a été ajusté pour tenir dans la place disponible. Toute la zone choisie est conservée.</Muted> : null}
        <Body>Aperçu de la carte à envoyer</Body>
        <Embed><AtlasPreview data={prepared!.preview} /></Embed>
        <Muted>Zoomez et déplacez l’aperçu pour examiner les éléments retenus dans la carte préparée.</Muted>
      </> : null}
      {preparing ? <>
        <Body>{status}</Body>
        <Button label="Annuler la préparation" variant="secondary" onPress={() => pending.current?.abort()} />
      </> : <Button label={plan ? 'Préparer à nouveau' : 'Préparer la carte'} variant={plan ? 'secondary' : 'primary'} disabled={!options || sending !== undefined || budget === 0} onPress={() => void prepare()} />}
      {limit === undefined ? <Muted>Connectez un compteur compatible pour installer la carte ; son firmware peut nécessiter une mise à jour.</Muted> : plan && plan.bytes.length > limit ? <Muted>La place disponible a changé : préparez à nouveau la carte pour adapter son détail.</Muted> : null}
      {plan?.source === 'osm' && device && !compatible ? <Muted>Mettez à jour le firmware du compteur pour installer les cartes OpenStreetMap détaillées. Les fonds inclus restent compatibles.</Muted> : null}
      {plan ? <Button label={sending === undefined ? 'Installer sur le compteur' : `Installation… ${Math.round(sending * 100)} %`}
        disabled={!device || limit === undefined || plan.bytes.length > limit || !compatible || busy} onPress={() => void send()} /> : null}
      {sent ? <Body>Carte globale installée. Elle sera conservée pour les prochaines traces.</Body> : null}
    </Section>
  </Screen>;
}
