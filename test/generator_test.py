import unittest, subprocess, tempfile, pathlib, json, os
ROOT=pathlib.Path(__file__).resolve().parents[1]
class GeneratorTests(unittest.TestCase):
 def test_allowlisted_keys_only_no_shell_and_restricted_mode(self):
  script=ROOT/'generate-provider-config.py'
  self.assertTrue(script.exists(),'safe key generator missing')
  with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
   d=pathlib.Path(d);keys=d/'provider-keys.env';out=d/'config.mjs'
   keys.write_text('NAVER_MAP_KEY_ID=unit_public_naver\nGOOGLE_MAPS_API_KEY=unit_public_google\nUNRELATED_SECRET=never_emit\n');keys.chmod(0o600)
   p=subprocess.run(['python3',str(script),'--keys',str(keys),'--output',str(out),'--provider','naver','--opt-in'],capture_output=True,text=True)
   self.assertEqual(p.returncode,0,p.stderr);text=out.read_text();self.assertIn('unit_public_naver',text);self.assertNotIn('unit_public_google',text);self.assertNotIn('never_emit',text);self.assertNotIn('unit_public',p.stdout+p.stderr)
   keys.write_text('NAVER_MAP_KEY_ID=$(touch malicious)\n')
   p=subprocess.run(['python3',str(script),'--keys',str(keys),'--output',str(out),'--provider','naver','--opt-in'],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0);self.assertNotIn('$(touch',p.stderr);self.assertFalse((d/'malicious').exists())
 def test_auto_provider_needs_both_keys_and_records_boundary(self):
  script=ROOT/'generate-provider-config.py'
  with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
   d=pathlib.Path(d);keys=d/'provider-keys.env';out=d/'config.mjs'
   keys.write_text('NAVER_MAP_KEY_ID=unit_public_naver\n');keys.chmod(0o600)
   p=subprocess.run(['python3',str(script),'--keys',str(keys),'--output',str(out),'--provider','auto','--opt-in'],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0);self.assertIn('selected-provider-key-missing',p.stderr)
   keys.write_text('NAVER_MAP_KEY_ID=unit_public_naver\nGOOGLE_MAPS_API_KEY=unit_public_google\n')
   p=subprocess.run(['python3',str(script),'--keys',str(keys),'--output',str(out),'--provider','auto','--opt-in','--boundary-url','/local/ha-map/ha-map-korea-boundary.geojson'],capture_output=True,text=True)
   self.assertEqual(p.returncode,0,p.stderr);self.assertNotIn('unit_public',p.stdout+p.stderr)
   text=out.read_text();cfg=json.loads(text[text.index('(')+1:text.rindex(')')])
   self.assertEqual((cfg['mode'],cfg['provider']),('official','auto'));self.assertEqual(sorted(cfg['providers']),['google','naver'])
   self.assertNotIn('pin',cfg,'new configs must not require legacy version pins')
   self.assertTrue(cfg['boundary']['url'].startswith('/local/ha-map/ha-map-korea-boundary.geojson?v='))
   p=subprocess.run(['python3',str(script),'--keys',str(keys),'--output',str(out),'--provider','auto'],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0);self.assertIn('explicit-opt-in-required',p.stderr)
if __name__=='__main__':unittest.main()


class StyleIdTests(unittest.TestCase):
    def test_optional_naver_style_ids_are_validated_and_emitted(self):
        script = ROOT / 'generate-provider-config.py'
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
            d = pathlib.Path(d)
            keys = d / 'provider-keys.env'
            out = d / 'config.mjs'
            keys.write_text('NAVER_MAP_KEY_ID=unit_public_naver\n')
            keys.chmod(0o600)
            base = ['python3', str(script), '--keys', str(keys), '--output', str(out), '--provider', 'naver', '--opt-in']
            p = subprocess.run(base + ['--naver-style-dark', 'unit-dark-style'], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            text = out.read_text()
            cfg = json.loads(text[text.index('(') + 1:text.rindex(')')])
            self.assertEqual(cfg['providers']['naver']['styleIds'], {'dark': 'unit-dark-style'})
            p = subprocess.run(base + ['--naver-style-dark', 'bad id;'], capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('invalid-style-id', p.stderr)
            p = subprocess.run(base, capture_output=True, text=True)
            text = out.read_text()
            cfg = json.loads(text[text.index('(') + 1:text.rindex(')')])
            self.assertNotIn('styleIds', cfg['providers']['naver'])


class BoundaryDefaultTests(unittest.TestCase):
    def test_auto_without_boundary_url_leaves_it_to_the_entry_module(self):
        script = ROOT / 'generate-provider-config.py'
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
            d = pathlib.Path(d)
            keys = d / 'provider-keys.env'
            out = d / 'config.mjs'
            keys.write_text('NAVER_MAP_KEY_ID=unit_public_naver\nGOOGLE_MAPS_API_KEY=unit_public_google\n')
            keys.chmod(0o600)
            p = subprocess.run(['python3', str(script), '--keys', str(keys), '--output', str(out),
                                '--provider', 'auto', '--opt-in'], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            text = out.read_text()
            cfg = json.loads(text[text.index('(') + 1:text.rindex(')')])
            self.assertNotIn('boundary', cfg)
