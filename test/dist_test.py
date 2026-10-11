"""Production package checks: dist/ha-map mirrors tested modules and carries no keys."""
import hashlib, pathlib, re, subprocess, sys, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist' / 'ha-korea-map'
MODULES = ['ha-map-extension.mjs', 'ha-map-router.mjs', 'ha-map-sdk.mjs', 'ha-map-auto.mjs', 'ha-map-korea-boundary.geojson']


class DistTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_dist.py')], check=True, capture_output=True)

    def test_modules_identical_to_tested_sources(self):
        for name in MODULES:
            with self.subTest(name=name):
                self.assertEqual((DIST / name).read_bytes(), (ROOT / 'config' / 'www' / name).read_bytes())

    def test_bootstrap_uses_production_config_and_versions(self):
        text = (DIST / 'ha-korea-map.js').read_text()
        self.assertIn("./ha-map-config.mjs?v=auto-4", text)
        self.assertIn("./ha-map-extension.mjs?v=auto-4", text)
        self.assertNotIn('lab-config', text)

    def test_no_keys_or_generated_config_in_package(self):
        self.assertFalse((DIST / 'ha-map-config.mjs').exists())
        for path in DIST.rglob('*'):
            if path.is_file():
                text = path.read_text(errors='ignore')
                self.assertNotRegex(text, r'AIza[0-9A-Za-z_-]{20,}', path.name)

    def test_checksums_and_install_guide(self):
        sums = (ROOT / 'dist' / 'SHA256SUMS').read_text()
        for path in sorted(DIST.iterdir()):
            self.assertIn(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  ha-korea-map/{path.name}', sums)
        guide = (ROOT / 'dist' / 'INSTALL.md').read_text()
        for needle in ['extra_module_url', '/local/ha-korea-map/ha-korea-map.js?v=auto-4', '/config/www/ha-korea-map/', 'HTTP 리퍼러', '3.2.3(e)',
                       'CC BY 3.0 IGO', 'CC BY 4.0', '롤백', 'pin', '캐시', '--provider auto']:
            self.assertIn(needle, guide)
        self.assertTrue((DIST / 'ATTRIBUTION.md').exists())


if __name__ == '__main__':
    unittest.main()
