"""Korea map-center region checks (stdlib point tests; shapely overlap test runs in .venv)."""
import json, math, pathlib, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'config' / 'www' / 'ha-map-korea-boundary.geojson'
INSIDE = {
    'seoul': (37.5665, 126.9780), 'busan': (35.1796, 129.0756), 'jeju': (33.4996, 126.5312),
    'ulleungdo': (37.4844, 130.9057), 'dokdo': (37.2414, 131.8689), 'baengnyeongdo': (37.97, 124.68),
    'marado': (33.1167, 126.2667), 'marado_south_tip': (33.1120, 126.2690), 'yeonpyeongdo': (37.6670, 125.7000), 'gageodo': (34.0700, 125.1100),
    'sea_10km_off_gangneung': (37.7600, 129.0200), 'sea_off_busan': (35.0500, 129.1500),
    'sea_beside_baengnyeongdo_west': (37.9600, 124.5800),
}
OUTSIDE = {
    'tsushima': (34.4, 129.3), 'tsushima_north': (34.65, 129.45), 'fukuoka': (33.5904, 130.4017),
    'iki': (33.78, 129.72), 'pyongyang': (39.0392, 125.7625), 'dandong': (40.1291, 124.3947),
    'kaesong': (37.9707, 126.5544), 'haeju': (38.0406, 125.7147), 'tokyo': (35.6762, 139.6503),
    'oki': (36.2, 133.3), 'sea_45km_off_gangneung': (37.76, 129.45), 'shanghai': (31.2304, 121.4737),
    'beijing': (39.9042, 116.4074),
}


def ring_contains(ring, lon, lat):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def contains(geom, lat, lon):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    return any(ring_contains(p[0], lon, lat) and not any(ring_contains(h, lon, lat) for h in p[1:]) for p in polys)


class KoreaBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fc = json.loads(OUT.read_text())
        cls.geom = cls.fc['features'][0]['geometry']

    def test_browser_file_is_small_and_attributed(self):
        self.assertLess(OUT.stat().st_size, 100_000)
        props = self.fc['features'][0]['properties']
        self.assertIn('Natural Earth', props['attribution']); self.assertIn('approximate', props['name'])

    def test_required_inclusions(self):
        for name, (lat, lon) in INSIDE.items():
            with self.subTest(name=name):
                self.assertTrue(contains(self.geom, lat, lon), name)

    def test_required_exclusions(self):
        for name, (lat, lon) in OUTSIDE.items():
            with self.subTest(name=name):
                self.assertFalse(contains(self.geom, lat, lon), name)

    def test_sources_and_readme_record_hashes(self):
        readme = (ROOT / 'data' / 'README.md').read_text()
        import hashlib
        for path in sorted((ROOT / 'data' / 'source').glob('*.geojson')):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertIn(digest, readme, path.name)

    def test_no_overlap_with_foreign_land(self):
        try:
            import shapely  # noqa: F401
        except ImportError:
            self.skipTest('shapely only in .venv')
        import sys; sys.path.insert(0, str(ROOT / 'tools'))
        import build_korea_boundary as b
        from shapely.geometry import shape
        region = b.project(shape(self.geom), b.fwd)
        _, claims = b.korean_claims()
        claims = b.project(claims, b.fwd)
        # bbox-clipped, unsimplified source land (memory-safe), minus NE Korean claim areas
        foreign = b.foreign_land(claims, simplify_km=0)
        self.assertLess(region.intersection(foreign).area, 0.01)
        # Japan's source polygon for Dokdo is the only foreign land deliberately ignored
        _, jpn = b.load('geoBoundaries-JPN-ADM0.geojson', simplify_km=0)
        ignored = region.intersection(jpn).difference(foreign)
        dokdo = b.project(__import__('shapely').Point(*b.DOKDO), b.fwd).buffer(3)
        self.assertTrue(ignored.is_empty or dokdo.contains(ignored))


if __name__ == '__main__':
    unittest.main()
