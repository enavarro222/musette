#!/usr/bin/env python3
"""Rebuild the bundled Europe overview and enriched French regional atlases.

Downloads are cached in target/atlas-source. Geometry is clipped/simplified
here; the OCAT writer/validator is the shared Rust crate, not a second encoder.
See app/assets/atlas/README.md for source attribution and data licences.
Run from the repository root: python3 tools/build_atlas.py
"""
import hashlib
import json
import math
import subprocess
import unicodedata
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'target/atlas-source'
CACHE.mkdir(parents=True, exist_ok=True)
BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'

EXTRA_URLS = {
    'fr-communes.json': 'https://geo.api.gouv.fr/communes?fields=nom,code,population,centre&format=json&geometry=centre',
    'fr-departements.geojson': 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/departements-100m.geojson',
}


def dataset(name):
    filename = name if name in EXTRA_URLS else name+'.geojson'
    path = CACHE / filename
    if not path.exists():
        with urlopen(EXTRA_URLS.get(filename, BASE+filename), timeout=60) as r:
            path.write_bytes(r.read())
    expected = json.loads((ROOT/'tools/atlas-sources.json').read_text())[path.name]
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError(f'{path.name}: source changed; review data and update tools/atlas-sources.json before rebuilding')
    data = json.loads(path.read_text())
    return data['features'] if isinstance(data, dict) else data

def lines(geom):
    kind, c = geom['type'], geom['coordinates']
    if kind == 'LineString':
        yield c
    elif kind in ('MultiLineString', 'Polygon'):
        yield from c
    elif kind == 'MultiPolygon':
        for rings in c:
            yield from rings


def clip_segment(a, b, box):
    x0, y0, x1, y1 = box
    dx, dy = b[0] - a[0], b[1] - a[1]
    lo, hi = 0.0, 1.0
    for p, q in [(-dx, a[0]-x0), (dx, x1-a[0]), (-dy, a[1]-y0), (dy, y1-a[1])]:
        if p == 0:
            if q < 0:
                return None
        elif p < 0:
            lo = max(lo, q / p)
        else:
            hi = min(hi, q / p)
        if lo > hi:
            return None
    return ((a[0]+lo*dx, a[1]+lo*dy), (a[0]+hi*dx, a[1]+hi*dy))


def clipped(points, box):
    piece = []
    for a, b in zip(points, points[1:]):
        hit = clip_segment(a, b, box)
        if hit:
            p, q = hit
            if piece and math.dist(piece[-1], p) > 1e-8:
                yield piece
                piece = []
            if not piece:
                piece.append(p)
            piece.append(q)
        elif piece:
            yield piece
            piece = []
    if piece:
        yield piece


def simplify(pts, tolerance):
    keep = {0, len(pts)-1}
    stack = [(0, len(pts)-1)]
    while stack:
        lo, hi = stack.pop()
        ax, ay = pts[lo]
        bx, by = pts[hi]
        dx, dy = bx-ax, by-ay
        norm = dx*dx+dy*dy
        far, best = None, tolerance*tolerance
        for i in range(lo+1, hi):
            x, y = pts[i]
            t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/norm)) if norm else 0
            d = (x-ax-t*dx)**2+(y-ay-t*dy)**2
            if d > best:
                best, far = d, i
        if far is not None:
            keep.add(far)
            stack.extend([(lo, far), (far, hi)])
    return [pts[i] for i in sorted(keep)]



def europe():
    features = []
    box = (-25,34,45,72)
    scale = 111320*math.cos(math.radians(53))
    project = lambda p: ((p[0]-10)*scale,(p[1]-53)*111320)
    unproject = lambda p: (round((p[0]/scale+10)*1000),round((p[1]/111320+53)*1000))
    for kind, source in [(0,'ne_10m_admin_0_countries'),(1,'ne_10m_rivers_lake_centerlines')]:
        for feature in dataset(source):
            for line in lines(feature['geometry']):
                for piece in clipped(line,box):
                    if len(piece)<2: continue
                    pts=list(map(project,piece))
                    for level,tol in enumerate([300,1500,7500]):
                        q=[]
                        for p in simplify(pts,tol):
                            p=unproject(p)
                            if not q or p!=q[-1]: q.append(p)
                        for first in range(0,max(0,len(q)-1),254):
                            part=q[first:first+255]
                            if len(part)>1:
                                features.append(dict(class_=kind,level=level,label='',points=part))
    for city in sorted(dataset('ne_10m_populated_places_simple'),key=lambda f:f['properties'].get('pop_max') or 0,reverse=True):
        lon,lat=city['geometry']['coordinates']
        p={k.lower():v for k,v in city['properties'].items()}
        if not (box[0]<=lon<=box[2] and box[1]<=lat<=box[3] and (p.get('pop_max') or 0)>=50000): continue
        name=unicodedata.normalize('NFKD',p.get('nameascii') or p.get('name') or '').encode('ascii','ignore').decode()[:24]
        features.append(dict(class_=2,level=0,label=name,points=[(round(lon*1000),round(lat*1000))]))
    for f in features: f['class']=f.pop('class_')
    pack('europe', 'Europe', features)


def pack(key, name, features):
    payload=json.dumps(dict(name=name,features=features)).encode()
    packed=subprocess.run(['cargo','run','--quiet','-p','route-cc600','--example','atlas_pack','--features','build'],input=payload,stdout=subprocess.PIPE,check=True,cwd=ROOT).stdout
    dest=ROOT/'app/assets/atlas'/f'{key}.ocat'
    dest.write_bytes(packed)
    print(f'{dest}: {len(packed)} bytes; sha256={hashlib.sha256(packed).hexdigest()}')

def ascii_name(name):
    return unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()[:24]


def intersects(line, box):
    return (min(p[0] for p in line) <= box[2] and max(p[0] for p in line) >= box[0]
            and min(p[1] for p in line) <= box[3] and max(p[1] for p in line) >= box[1])


def regional_lines(features, geometry, kind, box):
    scale = 111320 * math.cos(math.radians((box[1]+box[3])/2))
    for line in geometry:
        if not intersects(line, box):
            continue
        for piece in clipped(line, box):
            pts = [(p[0]*scale, p[1]*111320) for p in piece]
            for level, tolerance in enumerate([100, 500, 2500]):
                q = []
                for x, y in simplify(pts, tolerance):
                    p = (round(x/scale*1000), round(y/111320*1000))
                    if not q or p != q[-1]:
                        q.append(p)
                for first in range(0, max(0, len(q)-1), 254):
                    part = q[first:first+255]
                    if len(part) > 1:
                        features.append(dict(class_=kind, level=level, label='', points=part))


def regional():
    # Pre-filter global linework to metropolitan France and its neighbours once.
    france = (-5.5, 41, 10, 51.5)
    sources = []
    for kind, name in [(3, 'ne_10m_roads'), (4, 'fr-departements.geojson'),
                       (0, 'ne_10m_admin_0_countries'), (5, 'ne_10m_lakes'),
                       (1, 'ne_10m_rivers_lake_centerlines')]:
        geometry = []
        for f in dataset(name):
            if kind == 3 and f['properties'].get('type') not in ('Major Highway', 'Secondary Highway', 'Road'):
                continue
            for line in lines(f['geometry']):
                if len(line) > 1 and intersects(line, france):
                    geometry.append(line)
        sources.append((kind, geometry))
    communes = sorted(dataset('fr-communes.json'), key=lambda c: c.get('population') or 0, reverse=True)
    foreign = sorted(dataset('ne_10m_populated_places_simple'), key=lambda f: f['properties'].get('pop_max') or 0, reverse=True)
    zones = json.loads((ROOT/'app/src/lib/atlasZones.json').read_text())
    for key, zone in zones.items():
        if key in ('france', 'europe'):
            continue
        features = []
        box = zone['bounds']
        for kind, geometry in sources:
            regional_lines(features, geometry, kind, box)
        cities = []
        for c in communes:
            pop = c.get('population') or 0
            if pop < 2000 or not c.get('centre'):
                continue
            lon, lat = c['centre']['coordinates']
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3]:
                cities.append((pop, c['nom'], lon, lat))
        for f in foreign:
            p = f['properties']
            if p.get('iso_a2') == 'FR' or (p.get('pop_max') or 0) < 2000:
                continue
            lon, lat = f['geometry']['coordinates']
            if box[0] <= lon <= box[2] and box[1] <= lat <= box[3]:
                cities.append((p.get('pop_max') or 0, p.get('nameascii') or p.get('name') or '', lon, lat))
        for _, name, lon, lat in sorted(cities, key=lambda c: c[0], reverse=True):
            features.append(dict(class_=2, level=0, label=ascii_name(name),
                                 points=[(round(lon*1000), round(lat*1000))]))
        for f in features:
            f['class'] = f.pop('class_')
        pack(key, zone['name'], features)


def main():
    europe()
    regional()


if __name__ == '__main__':
    main()
