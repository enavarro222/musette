<script lang="ts">
  import { app } from './lib/state.svelte';
  import Devices from './screens/Devices.svelte';
  import Activities from './screens/Activities.svelte';
  import Routes from './screens/Routes.svelte';
  import Project from './screens/Project.svelte';

  type Tab = 'devices' | 'activities' | 'routes' | 'project';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'devices', label: 'Compteur' },
    { id: 'activities', label: 'Sorties' },
    { id: 'routes', label: 'Traces' },
    { id: 'project', label: 'Projet' },
  ];
  let tab = $state<Tab>('devices');

  $effect(() => {
    if (app.pendingRoute) tab = 'routes';
  });
</script>

<main>
  {#if tab === 'devices'}
    <Devices onsynced={() => (tab = 'activities')} />
  {:else if tab === 'activities'}
    <Activities />
  {:else if tab === 'routes'}
    <Routes />
  {:else}
    <Project />
  {/if}
</main>

{#if app.error}
  <div class="toast" role="alert">
    <span>{app.error}</span>
    <button type="button" onclick={() => (app.error = undefined)}>OK</button>
  </div>
{/if}

<nav aria-label="Navigation principale">
  {#each tabs as t (t.id)}
    <button
      type="button"
      class:active={tab === t.id}
      aria-current={tab === t.id ? 'page' : undefined}
      onclick={() => (tab = t.id)}>{t.label}</button
    >
  {/each}
</nav>
