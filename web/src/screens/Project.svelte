<script lang="ts">
  /** Set to your Ko-fi page to show the support button. */
  const KOFI_URL = '';
  const REPO = 'https://github.com/enavarro222/musette';
  const FIRMWARE = 'https://github.com/enavarro222/opencc600';
</script>

<h1>Projet</h1>
<p class="muted">Musette est libre (MIT) et fonctionne sans compte ni serveur : vos sorties restent sur votre appareil.</p>

{#if KOFI_URL}
  <section class="card dark">
    <div class="title">Soutenir le projet</div>
    <p>Un café aide à financer le matériel de test et le temps de développement.</p>
    <a class="button light" href={KOFI_URL} target="_blank" rel="noopener">Soutenir sur Ko-fi</a>
  </section>
{/if}

<section class="card list">
  <a class="row link" href="{REPO}/issues/new" target="_blank" rel="noopener">Signaler un bug ou proposer une idée</a>
  <a class="row link" href={REPO} target="_blank" rel="noopener">Code source de l’appli</a>
  <a class="row link" href={FIRMWARE} target="_blank" rel="noopener">Firmware OpenCC600</a>
</section>
