/** Set to your Ko-fi page to show the support button. */
const KOFI_URL = '';
const REPO = 'https://github.com/enavarro222/musette';
const FIRMWARE = 'https://github.com/enavarro222/opencc600';

export default function Project() {
  return (
    <>
      <h1>Projet</h1>
      <p className="muted">
        Musette est libre (MIT) et fonctionne sans compte ni serveur : vos sorties restent sur votre appareil.
      </p>

      {KOFI_URL && (
        <section className="card dark">
          <div className="title">Soutenir le projet</div>
          <p>Un café aide à financer le matériel de test et le temps de développement.</p>
          <a className="button light" href={KOFI_URL} target="_blank" rel="noopener">
            Soutenir sur Ko-fi
          </a>
        </section>
      )}

      <section className="card list">
        <a className="row link" href={`${REPO}/issues/new`} target="_blank" rel="noopener">
          Signaler un bug ou proposer une idée
        </a>
        <a className="row link" href={REPO} target="_blank" rel="noopener">
          Code source de l’appli
        </a>
        <a className="row link" href={FIRMWARE} target="_blank" rel="noopener">
          Firmware OpenCC600
        </a>
      </section>
    </>
  );
}
