<script lang="ts">
  import { activities, shareFile, type StoredActivity } from '../lib/storage';
  import { reportError } from '../lib/state.svelte';

  let list = $state<StoredActivity[]>([]);

  async function refresh() {
    list = await activities.all().catch((e) => (reportError(e), []));
  }

  $effect(() => {
    void refresh();
  });

  const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

  async function remove(a: StoredActivity) {
    if (!confirm(`Supprimer « ${a.fileName} » de cet appareil ? Cette action est définitive.`)) return;
    await activities.remove(a.key).catch(reportError);
    await refresh();
  }
</script>

<h1>Sorties</h1>
<p class="muted">Fichiers FIT stockés dans ce navigateur.</p>

{#if list.length === 0}
  <section class="card"><p class="muted">Aucune sortie pour l’instant. Connectez un compteur pour les récupérer.</p></section>
{:else}
  <section class="card list">
    {#each list as a (a.key)}
      <div class="row">
        <div class="grow">
          <div class="title">{fmt.format(new Date((a.startTime ?? a.importedAt / 1000) * 1000))}</div>
          <div class="muted small">{a.deviceName} · {(a.fit.byteLength / 1024).toFixed(0)} Ko</div>
        </div>
        <button type="button" class="secondary" onclick={() => shareFile(a.fileName, a.fit).catch(reportError)}>FIT</button>
        <button type="button" class="ghost" aria-label="Supprimer" onclick={() => remove(a)}>✕</button>
      </div>
    {/each}
  </section>
{/if}
