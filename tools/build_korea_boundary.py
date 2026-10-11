#!/usr/bin/env python3
"""Build the browser Korea map-center region from pinned public source files.

Run with the lab venv (shapely) and a memory cap, e.g.
    prlimit --as=2500000000 -- .venv/bin/python tools/build_korea_boundary.py

Region = Korean land (geoBoundaries KOR U Natural Earth 'Admin-0 claim area' features
with ADM0_A3=KOR, i.e. Dokdo and the NLL islands) buffered by 12 nautical miles.
Sea that is also within 12 nmi of foreign land (PRK/JPN/CHN) is split on an
approximate equidistance line (Voronoi of coastline samples, ~1.5 km spacing),
then foreign land (+0.35 km margin) is removed.

Memory safety: every source polygon is clipped to a Korea-area bbox and simplified
before any union/buffer; the full 7 MB Japan file is never unioned as a whole.
This is an APPROXIMATION for choosing a map renderer, not a legal territorial-sea line.
"""
import gc, hashlib, json, pathlib, sys
import numpy as np
import shapely
from shapely.geometry import shape, mapping, MultiPoint, MultiPolygon

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'data' / 'source'
OUT = ROOT / 'config' / 'www' / 'ha-map-korea-boundary.geojson'
REPORT = ROOT / 'data' / 'korea-boundary-build.json'
R = 6371.0088  # km
LON0 = 127.5
BBOX = (121.5, 31.0, 134.5, 41.0)  # lon/lat clip window around Korea
BUFFER_KM = 12 * 1.852  # 22.224 km
SOURCE_SIMPLIFY_KM = 0.1
SIMPLIFY_KM = 0.3
SAMPLE_KM = 1.5
FOREIGN_MARGIN_KM = 0.35
MIN_PART_KM2 = 0.05
DOKDO = (131.8689, 37.2414)


def fwd(lon, lat):
    """Sinusoidal projection centred on 127.5E (km). Distances near Korea within a few %."""
    lat_r = np.radians(lat)
    return R * np.radians(lon - LON0) * np.cos(lat_r), R * lat_r


def inv(x, y):
    lat = np.degrees(y / R)
    return LON0 + np.degrees(x / (R * np.cos(np.radians(lat)))), lat


def project(g, f):
    return shapely.transform(g, lambda c: np.column_stack(f(c[:, 0], c[:, 1])))


def polygons(g):
    if g.geom_type == 'GeometryCollection':
        return [p for part in g.geoms for p in polygons(part)]
    return [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'Polygon' and not p.is_empty]


def load(name, simplify_km=SOURCE_SIMPLIFY_KM):
    """Return (lon/lat geometry clipped to BBOX, projected+simplified geometry)."""
    fc = json.loads((SRC / name).read_text())
    parts = []
    for feature in fc['features']:
        for poly in polygons(shape(feature['geometry'])):
            minx, miny, maxx, maxy = poly.bounds
            if maxx < BBOX[0] or minx > BBOX[2] or maxy < BBOX[1] or miny > BBOX[3]:
                continue
            parts.extend(polygons(shapely.clip_by_rect(shapely.make_valid(poly), *BBOX)))
    del fc
    gc.collect()
    ll = shapely.union_all(parts) if parts else MultiPolygon()
    proj = project(ll, fwd)
    if simplify_km:
        proj = shapely.make_valid(proj.simplify(simplify_km, preserve_topology=True))
    return ll, proj


def korean_claims():
    ne = json.loads((SRC / 'ne_10m_admin_0_disputed_areas.geojson').read_text())
    picks = [f for f in ne['features'] if f['properties'].get('ADM0_A3') == 'KOR'
             and f['properties'].get('featurecla') == 'Admin-0 claim area']
    return sorted(f['properties']['NAME'] for f in picks), shapely.union_all([shape(f['geometry']) for f in picks])


def foreign_land(claims_proj, simplify_km=SOURCE_SIMPLIFY_KM):
    """Projected foreign land, minus areas Natural Earth marks as administered by South Korea."""
    parts = [load(f'geoBoundaries-{c}-ADM0.geojson', simplify_km)[1] for c in ('PRK', 'JPN', 'CHN')]
    foreign = shapely.union_all(parts)
    # JPN (MLIT) includes Dokdo and PRK may include NLL islands; the user requires
    # these as Korean. Drop whole foreign polygons within 3 km of an NE Korean claim
    # area (source datasets digitise the islets at slightly different positions),
    # then remove the claim areas (+0.5 km) from what remains (e.g. PRK coast).
    near = claims_proj.buffer(3, quad_segs=4)
    kept = [p for p in polygons(foreign) if not near.contains(p)]
    return shapely.union_all(kept).difference(claims_proj.buffer(0.5, quad_segs=4))


def sample(boundary, spacing):
    pts = []
    for line in getattr(boundary, 'geoms', [boundary]):
        if line.is_empty or line.geom_type not in ('LineString', 'LinearRing'):
            continue
        n = max(2, int(line.length / spacing) + 1)
        pts.extend(line.interpolate(np.linspace(0, line.length, n)))
    return pts


def build():
    claim_names, claims_ll = korean_claims()
    _, kor = load('geoBoundaries-KOR-ADM0.geojson')
    claims = project(claims_ll, fwd)
    K = shapely.union_all([kor, claims])
    F_all = foreign_land(claims)
    # Only foreign land within 2x12 nmi matters. Buffering the whole clipped
    # multi-thousand-part foreign mask in one GEOS call exhausted memory, so
    # clip first and buffer each remaining polygon separately.
    F = F_all.intersection(K.buffer(2 * BUFFER_KM + 5, quad_segs=2))
    B = K.buffer(BUFFER_KM, quad_segs=6)
    FB = shapely.union_all([p.buffer(BUFFER_KM, quad_segs=6) for p in polygons(F)])
    Z = B.intersection(FB)  # contested 12 nmi overlap
    region = B.difference(Z)
    voronoi_points = 0
    if not Z.is_empty:
        window = Z.buffer(5, quad_segs=2)
        reach = window.buffer(BUFFER_KM, quad_segs=2)
        kp = sample(K.boundary.intersection(reach), SAMPLE_KM)
        fp = sample(F.boundary.intersection(reach), SAMPLE_KM)
        voronoi_points = len(kp) + len(fp)
        cells = shapely.voronoi_polygons(MultiPoint(kp + fp), extend_to=window.envelope)
        tree = shapely.STRtree(kp)
        korea_cells = shapely.union_all([c for c in cells.geoms if len(tree.query(c, predicate='intersects'))])
        region = shapely.union_all([region, Z.intersection(korea_cells)])
    region = shapely.union_all([region, K])
    simplified = region.simplify(SIMPLIFY_KM, preserve_topology=True)
    guard = shapely.union_all([p.buffer(FOREIGN_MARGIN_KM, quad_segs=3) for p in polygons(F)])
    simplified = shapely.make_valid(simplified.difference(guard))
    simplified = MultiPolygon([p for p in polygons(simplified) if p.area >= MIN_PART_KM2])
    out_ll = shapely.set_precision(project(simplified, inv), 0.0001, mode='pointwise')
    out_ll = shapely.make_valid(out_ll)
    out_ll = MultiPolygon([p for p in polygons(out_ll) if project(p, fwd).area >= MIN_PART_KM2])
    return out_ll, dict(F=F_all, claim_names=claim_names, voronoi_points=voronoi_points)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    out_ll, ctx = build()
    assert out_ll.is_valid, 'output geometry invalid'
    sources = {p.name: sha(p) for p in sorted(SRC.glob('*.geojson'))}
    fc = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {
        'name': 'Republic of Korea map-center region (approximate, 12 nmi buffer)',
        'purpose': 'map renderer selection only; not a legal boundary',
        'buffer_nmi': 12, 'simplify_km': SIMPLIFY_KM, 'foreign_margin_km': FOREIGN_MARGIN_KM,
        'attribution': 'Natural Earth (public domain); geoBoundaries gbOpen 9469f09 (KOR/CHN public domain, PRK CC BY 3.0 IGO WFP/OCHA ROAP, JPN CC BY 4.0 MLIT National Land Numerical Information)',
        'source_sha256': sources}, 'geometry': mapping(out_ll)}]}
    text = json.dumps(fc, separators=(',', ':'))
    OUT.write_text(text)
    proj = project(out_ll, fwd)
    report = {'output': str(OUT.relative_to(ROOT)), 'bytes': len(text.encode()),
              'sha256': hashlib.sha256(text.encode()).hexdigest(),
              'polygons': len(out_ll.geoms), 'vertices': int(shapely.get_num_coordinates(out_ll)),
              'area_km2': round(proj.area), 'foreign_land_overlap_km2': round(proj.intersection(ctx['F']).area, 6),
              'voronoi_points': ctx['voronoi_points'],
              'ne_claim_areas_added': ctx['claim_names'], 'sources_sha256': sources}
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'sources_sha256'}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
