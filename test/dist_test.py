"""Package checks: dist/ is the flat HACS plugin folder, mirrors tested sources, carries no keys."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
FILES = ['ha-korea-map.js', 'ha-map-extension.mjs', 'ha-map-router.mjs', 'ha-map-sdk.mjs',
         'ha-map-cluster.mjs', 'ha-map-auto.mjs', 'ha-map-korea-boundary.geojson']


class DistTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_dist.py')], check=True, capture_output=True)

    def test_files_identical_to_tested_sources(self):
        for name in FILES:
            with self.subTest(name=name):
                self.assertEqual((DIST / name).read_bytes(), (ROOT / 'config' / 'www' / name).read_bytes())

    def test_flat_for_hacs(self):
        # HACS only downloads files directly inside dist/, never subfolders.
        self.assertEqual([p.name for p in DIST.iterdir() if p.is_dir()], [])
        manifest = json.loads((ROOT / 'hacs.json').read_text())
        self.assertEqual(manifest['filename'], 'ha-korea-map.js')
        self.assertTrue((DIST / manifest['filename']).is_file())
        self.assertEqual(manifest['homeassistant'], '2026.10.1')
        self.assertTrue(manifest['name'])
        self.assertNotIn('content_in_root', manifest)
        # A root-level ha-korea-map.js would make HACS ignore dist/.
        self.assertFalse((ROOT / 'ha-korea-map.js').exists())

    def test_entry_reads_external_config_and_uses_current_cache_version(self):
        text = (DIST / 'ha-korea-map.js').read_text()
        self.assertIn('"/local/ha-korea-map-config.mjs"', text)
        self.assertIn('./ha-map-extension.mjs?v=auto-6', text)
        self.assertNotIn('lab-config', text)

    def test_no_keys_or_generated_config_in_package(self):
        for path in DIST.iterdir():
            self.assertNotIn('config', path.name)
            text = path.read_text(errors='ignore')
            self.assertNotRegex(text, r'AIza[0-9A-Za-z_-]{20,}', path.name)

    def test_complete_package_and_uniform_cache_version(self):
        self.assertEqual({p.name for p in DIST.iterdir()}, set(FILES) | {'ATTRIBUTION.md', 'SHA256SUMS'})
        versions = set()
        for name in FILES:
            if not name.endswith(('.js', '.mjs')):
                continue
            text = (DIST / name).read_text()
            versions.update(re.findall(r'\?v=(auto-\d+)', text))
            self.assertNotRegex(text, r'\.style\.filter\s*=')
            for spec in re.findall(r'(?:import|from)\s*\(?\s*"(\./[^"]+)"', text):
                target, sep, query = spec[2:].partition('?')
                self.assertIn(target, FILES)
                self.assertEqual(query, 'v=auto-6')
        self.assertEqual(versions, {'auto-6'})
        bootstrap = (ROOT / 'config/www/ha-map-lab-bootstrap.mjs').read_text()
        self.assertEqual(set(re.findall(r'\?v=(auto-\d+)', bootstrap)), versions)

    def test_checksums_and_install_guide(self):
        sums = (DIST / 'SHA256SUMS').read_text()
        for path in sorted(DIST.iterdir()):
            if path.name != 'SHA256SUMS':
                self.assertIn(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}', sums)
        self.assertTrue((DIST / 'ATTRIBUTION.md').exists())
        guide = (ROOT / 'docs' / 'INSTALL.md').read_text()
        for needle in ['HACS', '/hacsfiles/ha-korea-map/ha-korea-map.js', 'extra_module_url',
                       '/local/ha-korea-map/ha-korea-map.js?v=auto-6', '/config/www/ha-korea-map-config.mjs',
                       'HTTP 리퍼러', '3.2.3(e)', 'CC BY 3.0 IGO', 'CC BY 4.0', '롤백', 'pin', '캐시', '--provider auto']:
            self.assertIn(needle, guide)


if __name__ == '__main__':
    unittest.main()
