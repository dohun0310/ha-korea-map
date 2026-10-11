import {labConfig} from './ha-map-lab-config.mjs?v=auto-2';
import {startAutoHook} from './ha-map-extension.mjs?v=auto-2';
// Official SDKs remain deferred until a restricted public key and opt-in exist.
// A cold mount may still beat hook installation; parent must verify real timing.
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
