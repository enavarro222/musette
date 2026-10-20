export interface ParsedRoute {
  name: string;
  lats: number[];
  lons: number[];
  /** NaN where elevation is missing. */
  eles: number[];
}

/** Parse a GPX file (tracks first, then routes) with the platform XML parser. */
export function parseGpx(text: string): ParsedRoute {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier GPX illisible');

  let pts = Array.from(doc.getElementsByTagName('trkpt'));
  if (pts.length === 0) pts = Array.from(doc.getElementsByTagName('rtept'));
  if (pts.length < 2) throw new Error('Le GPX ne contient pas de trace');

  const route: ParsedRoute = {
    name: doc.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || 'Trace',
    lats: [],
    lons: [],
    eles: [],
  };
  for (const p of pts) {
    route.lats.push(Number(p.getAttribute('lat')));
    route.lons.push(Number(p.getAttribute('lon')));
    const ele = p.getElementsByTagName('ele')[0]?.textContent;
    route.eles.push(ele != null && ele !== '' ? Number(ele) : NaN);
  }
  return route;
}
