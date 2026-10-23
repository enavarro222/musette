import { useEffect, useState } from 'react';
import { loadCore, type ParsedRoute, type RouteAnalysis } from '../lib/core';
import { parseGpx } from '../lib/gpx';
import { routes } from '../lib/storage';
import { reportError } from '../lib/store';

/** A route of the library, read and analysed; `missing` once it is known to be gone. */
export function useRoute(id: string): { route?: ParsedRoute; analysis?: RouteAnalysis; missing: boolean } {
  const [route, setRoute] = useState<ParsedRoute>();
  const [analysis, setAnalysis] = useState<RouteAnalysis>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await routes.get(id);
        if (!stored) return setMissing(true);
        const parsed = await parseGpx(stored.gpx);
        setAnalysis((await loadCore()).analyzeRoute(parsed.lats, parsed.lons, parsed.eles));
        setRoute(parsed);
      } catch (e) {
        reportError(e);
      }
    })();
  }, [id]);

  return { route, analysis, missing };
}
