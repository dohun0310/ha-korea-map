import {labConfig} from './ha-map-config.mjs?v=auto-4';
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
