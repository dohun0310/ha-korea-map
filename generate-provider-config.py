#!/usr/bin/env python3
"""Generate browser config from allowlisted browser-restricted public keys.
Never source an env file or pass server secrets to Home Assistant /local.
"""
import argparse, hashlib, json, os, pathlib, re, stat, sys, tempfile
ROOT=pathlib.Path(__file__).resolve().parent
# Legacy diagnostic reference only; not emitted or required for installation.
PIN={'coreVersion':'2026.10.1','frontendVersion':'20260930.3','entrypoints':['/frontend_latest/core.ecb6c9be4886db2c.js','/frontend_latest/app.6234b2ff06eb162a.js'],'evidence':'container frontend manifest + rendered /map/0 HTML; active resource check at runtime'}
NAMES={'naver':'NAVER_MAP_KEY_ID','google':'GOOGLE_MAPS_API_KEY'}
def read_keys(path):
 if path.is_symlink():raise ValueError('key-file-symlink-refused')
 if not path.is_file():raise ValueError('key-file-missing')
 if path.stat().st_uid!=os.getuid():raise ValueError('key-file-owner-mismatch')
 path.chmod(0o600)
 result={}
 for line in path.read_text().splitlines():
  name,sep,value=line.partition('=');name=name.strip()
  if sep and name in NAMES.values():
   value=value.strip()
   if name in result:raise ValueError('duplicate-public-key-field')
   if value and not re.fullmatch(r'[A-Za-z0-9_-]{4,256}',value):raise ValueError('invalid-public-key-format')
   result[name]=value
 return result
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--provider',choices=['native','naver','google','auto'],default='native',help='auto: Korea boundary => naver, otherwise google (needs both keys)');p.add_argument('--boundary-url',help='same-origin URL of the boundary GeoJSON (auto only). Omit for the production entry, which uses the copy next to ha-korea-map.js; the lab bootstrap needs /local/ha-map-korea-boundary.geojson');p.add_argument('--boundary-file',type=pathlib.Path,default=ROOT/'config/www/ha-map-korea-boundary.geojson',help='local copy used for the cache-busting hash');p.add_argument('--opt-in',action='store_true',help='consent to SDK location requests and potential billing');p.add_argument('--allow-switching',action='store_true',help='explicitly enable both providers (terms unresolved; isolated private lab only)');p.add_argument('--keys',type=pathlib.Path,default=ROOT/'provider-keys.env');p.add_argument('--naver-style-light',help='optional NAVER Style Editor style id for light mode (needs the GL submodule)');p.add_argument('--naver-style-dark',help='optional NAVER Style Editor style id for dark mode (needs the GL submodule)');p.add_argument('--output',type=pathlib.Path,default=ROOT/'config/www/ha-map-lab-config.mjs');a=p.parse_args()
 try:
  providers={}
  if a.provider!='native':
   if not a.opt_in:raise ValueError('explicit-opt-in-required')
   keys=read_keys(a.keys)
   for name in (NAMES if a.allow_switching or a.provider=='auto' else [a.provider]):
    key=keys.get(NAMES[name],'')
    if not key:raise ValueError('selected-provider-key-missing')
    providers[name]={'key':key,'optIn':True}
  styles={mode:value for mode,value in (('light',a.naver_style_light),('dark',a.naver_style_dark)) if value}
  for value in styles.values():
   if not re.fullmatch(r'[A-Za-z0-9_-]{4,128}',value):raise ValueError('invalid-style-id')
  if styles and 'naver' in providers:providers['naver']['styleIds']=styles
  cfg={'mode':'native' if a.provider=='native' else 'official','provider':a.provider,'providers':providers}
  if a.provider=='auto' and a.boundary_url:
   if not re.fullmatch(r'/[A-Za-z0-9_./-]+\.geojson',a.boundary_url):raise ValueError('invalid-boundary-url')
   if not a.boundary_file.is_file():raise ValueError('boundary-file-missing')
   cfg['boundary']={'url':a.boundary_url+'?v='+hashlib.sha256(a.boundary_file.read_bytes()).hexdigest()[:12]}
  content='// Generated isolated lab config. Contains PUBLIC browser-restricted keys only.\nexport const labConfig=Object.freeze('+json.dumps(cfg,ensure_ascii=True,indent=2)+');\n'
  a.output.parent.mkdir(parents=True,exist_ok=True)
  if a.output.is_symlink():raise ValueError('output-symlink-refused')
  fd,tmp=tempfile.mkstemp(prefix='.provider-config-',dir=a.output.parent)
  try:
   with os.fdopen(fd,'w') as f:f.write(content)
   os.chmod(tmp,0o644);os.replace(tmp,a.output)
  finally:
   if os.path.exists(tmp):os.unlink(tmp)
  print('Configured mode='+cfg['mode']+' provider='+a.provider+'; key values omitted. Hard reload /map/0.')
  return 0
 except (ValueError,OSError,UnicodeError) as e:
  # Never stringify OSError or file content: paths/key strings may be sensitive.
  print('Configuration blocked: '+(str(e) if isinstance(e,ValueError) else 'file-operation-failed'),file=sys.stderr);return 2
if __name__=='__main__':sys.exit(main())
