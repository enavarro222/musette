<script lang="ts">
  import { MODELS, type ModelEntry } from '../lib/devices/registry';
  import { app, reportError } from '../lib/state.svelte';
  import { syncActivities } from '../lib/sync';

  let { onsynced }: { onsynced?: () => void } = $props();
  let status = $state('');
  let syncing = $state(false);

  const capabilityLabels: Record<string, string> = {
    downloadActivities: 'Récupération des sorties',
    uploadRoute: 'Envoi de trace',
    routeCorridorMap: 'Carte autour de la trace',
    climbsOnDevice: 'Montées sur le compteur',
    settings: 'Réglages',
    sensors: 'Capteurs',
    wifiSync: 'Synchro Wi-Fi',
  };

  async function connect(model: ModelEntry) {
    const device = model.create(app.platform!.transports);
    if (!device) return;
    app.connecting = true;
    try {
      await device.connect();
      app.device = device;
    } catch (e) {
      reportError(e);
    } finally {
      app.connecting = false;
    }
  }

  async function disconnect() {
    await app.device?.disconnect().catch(reportError);
    app.device = undefined;
    status = '';
  }

  async function sync() {
    if (!app.device) return;
    syncing = true;
    try {
      const n = await syncActivities(app.device, (m) => (status = m));
      if (n > 0) onsynced?.();
    } catch (e) {
      reportError(e);
    } finally {
      syncing = false;
    }
  }
</script>

<h1>Mon compteur</h1>

{#if app.device}
  <section class="card">
    <div class="row">
      <div class="grow">
        <div class="title">{app.device.name}</div>
        <span class="pill">Connecté</span>
      </div>
      <button type="button" class="secondary" onclick={disconnect}>Déconnecter</button>
    </div>
    <ul class="chips">
      {#each Object.entries(app.device.capabilities) as [key, on] (key)}
        {#if on}<li>{capabilityLabels[key] ?? key}</li>{/if}
      {/each}
    </ul>
  </section>

  {#if app.device.capabilities.downloadActivities}
    <section class="card accent">
      <div class="title">Sorties</div>
      <p class="muted">Copiées sur cet appareil, vérifiées, puis signalées au compteur.</p>
      <button type="button" class="primary" disabled={syncing} onclick={sync}>
        {syncing ? 'Récupération…' : 'Récupérer les sorties'}
      </button>
      {#if status}<p class="muted" aria-live="polite">{status}</p>{/if}
    </section>
  {/if}
{:else}
  <p class="muted">Choisissez votre compteur. Dans le navigateur, il faut le resélectionner à chaque visite.</p>
  <section class="card list">
    {#each MODELS as model (model.id)}
      {@const supported = !!model.create(app.platform!.transports)}
      <div class="row">
        <div class="grow">
          <div class="title">{model.label}</div>
          <div class="muted small">
            {supported ? model.connectHint : 'Non pris en charge par ce navigateur (essayez Chrome ou Edge sur ordinateur).'}
          </div>
        </div>
        <button type="button" class="primary" disabled={!supported || app.connecting} onclick={() => connect(model)}>
          Connecter
        </button>
      </div>
    {/each}
  </section>
{/if}
