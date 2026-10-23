import { CONTENTS, DETAILS, leftOut, type MapPlan, type SendOptions } from '../lib/mapPlan';
import type { MapState } from '../lib/mapSend';
import { size } from './format';

export const corridor = (m: number) => (m < 1000 ? `${m} m` : `${m / 1000} km`);

function detail(plan: MapPlan): string {
  return plan.detail === 'custom' ? 'personnalisé' : DETAILS[plan.detail].label.toLowerCase();
}

/** "Sans chemins ni ruisseaux, couloir de 500 m." */
function reduction(plan: MapPlan, o: SendOptions): string {
  const out = leftOut(plan, o).map((c) => CONTENTS[c].label.toLowerCase());
  const parts: string[] = [];
  if (out.length) parts.push(`sans ${out.length > 1 ? `${out.slice(0, -1).join(', ')} ni ${out.at(-1)}` : out[0]}`);
  if (plan.corridorM < o.corridorM) parts.push(`couloir de ${corridor(plan.corridorM)}`);
  const text = parts.join(', ');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}, pour tenir sur le compteur.` : '';
}

/** What the "Compteur" section says of the map: a title and a detail line. */
export function mapText(state: MapState, o: SendOptions): { title: string; detail?: string } | undefined {
  switch (state.status) {
    case 'off':
      return undefined;
    case 'unsupported':
      return { title: 'Fond de carte', detail: 'Ce compteur ne prend pas encore de fond de carte : mettez à jour OpenCC600.' };
    case 'full':
      return {
        title: 'Pas de place pour le fond de carte',
        detail: 'La mémoire du compteur est presque pleine : envoie tes sorties à l’appli, puis réessaie.',
      };
    case 'preparing':
      return { title: 'Fond de carte', detail: `Préparation (OpenStreetMap)… ${Math.round(state.ratio * 100)} %` };
    case 'failed':
      return { title: 'Fond de carte indisponible', detail: `${state.error} La trace partira seule.` };
    case 'ready': {
      const { plan, limit } = state;
      const of = limit ? ` sur ${size(limit)}` : '';
      if (!plan.fits) {
        return {
          title: 'Fond de carte trop grand',
          detail: `${size(plan.bytes.length)}, le compteur en prend ${size(limit ?? 0)} : la trace partira seule. Réduisez le détail ou le couloir dans les options d’envoi.`,
        };
      }
      return {
        title: `Fond de carte ${detail(plan)}${plan.reduced ? ' (allégé)' : ''}`,
        detail: [`${corridor(plan.corridorM)} autour de la trace · ${size(plan.bytes.length)}${of}`, plan.reduced ? reduction(plan, o) : '']
          .filter(Boolean)
          .join('\n'),
      };
    }
  }
}
