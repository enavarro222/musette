import { useEffect, useMemo, useState } from 'react';
import { parseGpx, type ParsedRoute } from '../lib/gpx';
import { appStore, reportError, useApp } from '../lib/store';
import { loadCore, type RouteAnalysis } from '../lib/wasm';

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
  const [gpxText, setGpxText] = useState('');
  const [analysis, setAnalysis] = useState<RouteAnalysis>();
  const [sending, setSending] = useState(false);

  async function load(file: File) {
    try {
      const text = await file.text();
      const parsed = parseGpx(text);
      const core = await loadCore();
      const result = core.analyzeRoute(
        Float64Array.from(parsed.lats),
        Float64Array.from(parsed.lons),
        Float64Array.from(parsed.eles),
      ) as RouteAnalysis;
      setGpxText(text);
      setRoute(parsed);
      setAnalysis(result);
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
    if (!confirm(`Remplacer la trace du compteur par « ${route.name} » ?`)) return;
    setSending(true);
    try {
      await device.uploadRoute(gpxText);
    } catch (e) {
      reportError(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h1>Traces</h1>

      <label className="card file">
        <span className="title">Ouvrir un fichier GPX</span>
        <span className="muted small">Exporté depuis Komoot, Openrunner ou un autre outil.</span>
        <input
          type="file"
          accept=".gpx,application/gpx+xml"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void load(f);
          }}
        />
      </label>

      {route && analysis && (
        <>
          <section className="card">
            <div className="title">{route.name}</div>
            <p className="muted">
              {km(analysis.distanceM)} km · {Math.round(analysis.ascentM)} m D+ · {analysis.climbs.length} montée(s)
            </p>
            {path && (
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profil d’altitude" className="profile">
                {analysis.climbs.map((c) => (
                  <rect
                    key={c.startM}
                    x={(c.startM / analysis.distanceM) * W}
                    width={((c.endM - c.startM) / analysis.distanceM) * W}
                    y={0}
                    height={H}
                    className="climb-band"
                  />
                ))}
                <path d={path} />
              </svg>
            )}
          </section>

          {analysis.climbs.length > 0 && (
            <section className="card list">
              <div className="title">Montées détectées</div>
              {analysis.climbs.map((c, i) => (
                <div className="row" key={c.startM}>
                  <span className="badge">{i + 1}</span>
                  <div className="grow">
                    <div>
                      km {km(c.startM)} · {km(c.endM - c.startM)} km · {pct(c.avgGrade)} %
                    </div>
                    <div className="muted small">
                      +{Math.round(c.gainM)} m · max {pct(c.maxGrade)} % · cat. {c.category}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          <button type="button" className="primary block" disabled={!canSend || sending} onClick={send}>
            {sending ? 'Envoi…' : 'Envoyer sur le compteur'}
          </button>
          {!device ? (
            <p className="muted small center">Connectez un compteur pour envoyer la trace.</p>
          ) : (
            !canSend && <p className="muted small center">L’envoi de trace n’est pas encore disponible pour ce compteur.</p>
          )}
        </>
      )}
    </>
  );
}
