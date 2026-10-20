<script lang="ts">
  import { parseGpx, type ParsedRoute } from '../lib/gpx';
  import { app, reportError } from '../lib/state.svelte';
  import { loadCore, type RouteAnalysis } from '../lib/wasm';

  let route = $state<ParsedRoute>();
  let gpxText = $state('');
  let analysis = $state<RouteAnalysis>();
  let sending = $state(false);

  async function load(file: File) {
    try {
      gpxText = await file.text();
      route = parseGpx(gpxText);
      const core = await loadCore();
      analysis = core.analyzeRoute(
        Float64Array.from(route.lats),
        Float64Array.from(route.lons),
        Float64Array.from(route.eles),
      ) as RouteAnalysis;
    } catch (e) {
      reportError(e);
    }
  }

  $effect(() => {
    if (app.pendingRoute) {
      const f = app.pendingRoute;
      app.pendingRoute = undefined;
      void load(f);
    }
  });

  const W = 600;
  const H = 120;
  let profilePath = $derived.by(() => {
    if (!analysis || analysis.profile.length < 2) return '';
    const p = analysis.profile;
    const min = Math.min(...p);
    const max = Math.max(...p);
    const sy = (e: number) => H - ((e - min) / Math.max(max - min, 1)) * (H - 10) - 5;
    return p.map((e, i) => `${i ? 'L' : 'M'}${((i / (p.length - 1)) * W).toFixed(1)} ${sy(e).toFixed(1)}`).join(' ');
  });

  let canSend = $derived(!!app.device?.capabilities.uploadRoute && !!app.device?.uploadRoute);

  async function send() {
    if (!app.device?.uploadRoute || !route) return;
    if (!confirm(`Remplacer la trace du compteur par « ${route.name} » ?`)) return;
    sending = true;
    try {
      await app.device.uploadRoute(gpxText);
    } catch (e) {
      reportError(e);
    } finally {
      sending = false;
    }
  }

  const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const pct = (g: number) => (g * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
</script>

<h1>Traces</h1>

<label class="card file">
  <span class="title">Ouvrir un fichier GPX</span>
  <span class="muted small">Exporté depuis Komoot, Openrunner ou un autre outil.</span>
  <input
    type="file"
    accept=".gpx,application/gpx+xml"
    onchange={(e) => {
      const f = e.currentTarget.files?.[0];
      if (f) void load(f);
    }}
  />
</label>

{#if route && analysis}
  <section class="card">
    <div class="title">{route.name}</div>
    <p class="muted">
      {km(analysis.distanceM)} km · {Math.round(analysis.ascentM)} m D+ · {analysis.climbs.length} montée(s)
    </p>
    {#if profilePath}
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Profil d’altitude" class="profile">
        {#each analysis.climbs as c (c.startM)}
          <rect
            x={(c.startM / analysis.distanceM) * W}
            width={((c.endM - c.startM) / analysis.distanceM) * W}
            y="0"
            height={H}
            class="climb-band"
          />
        {/each}
        <path d={profilePath} />
      </svg>
    {/if}
  </section>

  {#if analysis.climbs.length}
    <section class="card list">
      <div class="title">Montées détectées</div>
      {#each analysis.climbs as c, i (c.startM)}
        <div class="row">
          <span class="badge">{i + 1}</span>
          <div class="grow">
            <div>km {km(c.startM)} · {km(c.endM - c.startM)} km · {pct(c.avgGrade)} %</div>
            <div class="muted small">+{Math.round(c.gainM)} m · max {pct(c.maxGrade)} % · cat. {c.category}</div>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <button type="button" class="primary block" disabled={!canSend || sending} onclick={send}>
    {sending ? 'Envoi…' : 'Envoyer sur le compteur'}
  </button>
  {#if !app.device}
    <p class="muted small center">Connectez un compteur pour envoyer la trace.</p>
  {:else if !canSend}
    <p class="muted small center">L’envoi de trace n’est pas encore disponible pour ce compteur.</p>
  {/if}
{/if}
