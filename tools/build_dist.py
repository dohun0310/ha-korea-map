#!/usr/bin/env python3
"""Assemble dist/ha-korea-map/ for copying to production /config/www/ha-korea-map/.
Main entry is ha-korea-map.js (HACS Dashboard rule: same name as the repository).
Never copies generated configs (they hold browser keys)."""
import hashlib, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
WWW = ROOT / 'config' / 'www'
DIST = ROOT / 'dist'
PKG = DIST / 'ha-korea-map'
MODULES = ['ha-map-extension.mjs', 'ha-map-router.mjs', 'ha-map-sdk.mjs', 'ha-map-auto.mjs', 'ha-map-korea-boundary.geojson']
BOOTSTRAP = """import {labConfig} from './ha-map-config.mjs?v=auto-4';
import {startAutoHook} from './ha-map-extension.mjs?v=auto-4';
// Production entry (ha-korea-map.js). ha-map-config.mjs is generated on the HA host by
// generate-provider-config.py (see INSTALL.md); it is never shipped in dist/.
// Unknown HA/frontend versions fail closed: the original HA map stays untouched.
if(globalThis.customElements&&!globalThis.HA_MAP_LAB_HARNESS){
 globalThis.haMapExtensionReady=startAutoHook({config:labConfig}).then(ctl=>{
  globalThis.haMapExtension=ctl;
  return ctl;
 }).catch(error=>{
  const ctl={installed:false,reason:String(error),uninstall(){}};
  globalThis.haMapExtension=ctl;
  return ctl;
 });
}
"""


def main():
    old = DIST / 'ha-map'
    if old.exists():
        shutil.rmtree(old)
    if PKG.exists():
        shutil.rmtree(PKG)
    PKG.mkdir(parents=True)
    for name in MODULES:
        shutil.copyfile(WWW / name, PKG / name)
    (PKG / 'ha-korea-map.js').write_text(BOOTSTRAP)
    shutil.copyfile(ROOT / 'data' / 'README.md', PKG / 'ATTRIBUTION.md')
    shutil.copyfile(ROOT / 'generate-provider-config.py', DIST / 'generate-provider-config.py')
    lines = [f'{hashlib.sha256(p.read_bytes()).hexdigest()}  ha-korea-map/{p.name}' for p in sorted(PKG.iterdir())]
    lines.append(f"{hashlib.sha256((DIST / 'generate-provider-config.py').read_bytes()).hexdigest()}  generate-provider-config.py")
    (DIST / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
