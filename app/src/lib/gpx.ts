import { loadCore, type ParsedRoute } from './core';

const REASONS: Record<string, string> = {
  noPoints: 'Le GPX ne contient pas de trace',
  badPoint: 'Fichier GPX illisible',
};

/** Read a GPX file (tracks first, then routes) with the Rust reader. */
export async function parseGpx(text: string): Promise<ParsedRoute> {
  const core = await loadCore();
  try {
    return core.parseGpx(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : '';
    throw new Error(REASONS[reason] ?? 'Fichier GPX illisible');
  }
}
