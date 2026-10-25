import { useEffect, useState } from 'react';
import { loadRoute, reverseRoute, type LibraryRoute } from '../lib/library';
import { reportError } from '../lib/store';

/** A route of the library, read and analysed; `missing` once it is known to be gone. */
export function useRoute(id: string) {
  const [loaded, setLoaded] = useState<LibraryRoute>();
  const [missing, setMissing] = useState(false);
  const [loadedId, setLoadedId] = useState(id);
  if (loadedId !== id) {
    setLoadedId(id);
    setLoaded(undefined);
    setMissing(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await loadRoute(id);
        if (!active) return;
        setLoaded(result);
        setMissing(!result);
      } catch (e) {
        if (active) reportError(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  async function reverse() {
    setLoaded(await reverseRoute(id));
  }

  return { ...loaded, missing, reverse };
}
