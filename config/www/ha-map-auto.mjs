// Automatic provider choice: map centre inside the Korea boundary => NAVER, otherwise Google.
// The boundary is an approximation for renderer selection only (see data/README.md).
// Diagnostics never contain coordinates or keys.
const boundaryCache=new Map();
function ringContains(ring,lon,lat){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
export function pointInGeometry(geometry,point){
 if(!geometry||!Array.isArray(point))return false;const [lat,lon]=point;if(!Number.isFinite(lat)||!Number.isFinite(lon))return false;
 const polys=geometry.type==='MultiPolygon'?geometry.coordinates:geometry.type==='Polygon'?[geometry.coordinates]:[];
 return polys.some(([outer,...holes])=>ringContains(outer,lon,lat)&&!holes.some(h=>ringContains(h,lon,lat)));
}
export function classifyPoints(geometry,points){
 if(!Array.isArray(points)||!points.length)return null;let k=0;for(const p of points)if(pointInGeometry(geometry,p))k++;
 return k===points.length?'korea':k===0?'overseas':'mixed';
}
function validGeometry(fc){const g=fc?.type==='FeatureCollection'?fc.features?.[0]?.geometry:fc?.type==='Feature'?fc.geometry:fc;if(!g||!['Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates)||!g.coordinates.length)throw new Error('boundary-invalid');return g;}
export function loadBoundary(url,{fetch=globalThis.fetch,timeout=10000}={}){
 if(!url||typeof fetch!=='function')return Promise.reject(new Error('boundary-unavailable'));
 if(boundaryCache.has(url))return boundaryCache.get(url);
 const ctrl=typeof AbortController==='function'?new AbortController():null;let timer;
 const promise=Promise.race([
  Promise.resolve().then(()=>fetch(url,{credentials:'same-origin',signal:ctrl?.signal})).then(async res=>{if(!res?.ok)throw new Error('boundary-unavailable');return validGeometry(await res.json());}),
  new Promise((_,reject)=>{timer=setTimeout(()=>{ctrl?.abort();reject(new Error('boundary-timeout'));},timeout);timer?.unref?.();})
 ]).finally(()=>clearTimeout(timer));
 // Failed loads are not cached so a later page load can retry.
 promise.catch(()=>boundaryCache.delete(url));boundaryCache.set(url,promise);return promise;
}
const viewKey=v=>v?`${v.center?.[0]?.toFixed?.(5)},${v.center?.[1]?.toFixed?.(5)},${v.zoom}`:'';
export class AutoSwitch {
 constructor(router,{boundary,korea='naver',overseas='google',debounce=600,minInterval=2500,settle=1200,poll=1500,timers=globalThis}={}){
  boundary?.catch?.(()=>{});Object.assign(this,{router,boundary,korea,overseas,debounce,minInterval,settle,poll,timers});
  this.enabled=true;this.state='loading';this.decision=null;this.decisionReason=null;this.disabledReason=null;
  this.lastSwitch=-Infinity;this.quietUntil=-Infinity;this.fit=null;this.timer=null;this.running=false;this.dirty=false;this.dead=false;
  router.auto=this;router.desired='auto';router.onCamera=(kind,info)=>this.camera(kind,info);
 }
 now(){return this.timers.now?.()??Date.now();}
 later(fn,ms){this.cancelTimer();this.timer=this.timers.setTimeout(()=>{this.timer=null;fn();},ms);}
 cancelTimer(){if(this.timer!=null)this.timers.clearTimeout(this.timer);this.timer=null;}
 status(){this.router.onStatus?.();}
 async start(){
  if(this.poll&&this.timers.setInterval)this.interval=this.timers.setInterval(()=>this.pollView(),this.poll);
  let geometry;try{geometry=await this.boundary;}catch{if(this.dead)return;this.enabled=false;this.state='boundary-unavailable';this.disabledReason='boundary-unavailable';this.status();return;}
  if(this.dead)return;this.geometry=geometry;this.state='ready';this.status();
  if(this.enabled)await this.evaluate({immediate:true});
 }
 enable(){
  if(this.dead||!this.geometry)return Promise.resolve(false);
  this.enabled=true;this.disabledReason=null;this.router.desired='auto';this.status();return this.evaluate({immediate:true}).then(()=>true);
 }
 disable(reason='manual'){this.enabled=false;this.disabledReason=reason;this.fit=null;this.cancelTimer();if(reason==='manual')this.router.desired=undefined;this.status();}
 camera(kind,info={}){
  if(this.dead||!this.enabled||!this.geometry)return;
  if(kind==='programmatic'){
   this.quietUntil=this.now()+this.settle;
   if(info.method==='fitBounds'){const c=classifyPoints(this.geometry,info.args?.[0]);this.fit=c?{decision:c,args:info.args,method:'fitBounds',reason:`fit-${c==='korea'?'all-korea':c==='overseas'?'all-overseas':'mixed'}`}:null;}
   // NAVER clamps its camera to Korea (maxBounds), so judge setView/panTo by the REQUESTED centre, not the clamped result.
   else if((info.method==='setView'||info.method==='panTo')&&Array.isArray(info.args?.[0])){const inside=pointInGeometry(this.geometry,info.args[0]);this.fit={decision:inside?'korea':'overseas',args:info.args,method:info.method,reason:inside?'center-in-korea':'center-outside-korea'};}
   else this.fit=null;
   this.schedule();return;
  }
  // Engine move/zoom start: ignore the echo of our own calls and switches, and in-flight transitions.
  if(this.running||this.now()<this.quietUntil)return;
  this.fit=null;this.schedule();
 }
 pollView(){if(this.dead||!this.enabled||!this.geometry||this.fit||this.running||this.timer!=null)return;const k=viewKey(this.router.getView?.());if(k&&k!==this.lastKey){this.lastKey=k;this.schedule();}}
 schedule(){this.snapshot=viewKey(this.router.getView?.());this.later(()=>this.settled(),this.debounce);}
 settled(){if(this.dead||!this.enabled)return;const k=viewKey(this.router.getView?.());if(!this.fit&&k!==this.snapshot){this.snapshot=k;this.later(()=>this.settled(),this.debounce);return;}void this.evaluate();}
 decide(){
  if(this.fit){const d=this.fit.decision;return {decision:d,reason:this.fit.reason,target:d==='korea'?this.korea:this.overseas};}
  const view=this.router.getView?.();if(!view?.center)return null;const inside=pointInGeometry(this.geometry,view.center);
  return {decision:inside?'korea':'overseas',reason:inside?'center-in-korea':'center-outside-korea',target:inside?this.korea:this.overseas};
 }
 async evaluate({immediate=false}={}){
  if(this.dead||!this.enabled||!this.geometry)return;
  if(this.running){this.dirty=true;return;}
  const r=this.router;if(r.dead)return;
  if(r.safeMode){this.disable('safe-mode');return;}
  const d=this.decide();if(!d)return;this.decision=d.decision;this.decisionReason=d.reason;this.lastKey=viewKey(r.getView?.());
  if(r.current?.provider===d.target){this.status();return;}
  const wait=this.lastSwitch+this.minInterval-this.now();
  if(!immediate&&wait>0){this.later(()=>void this.evaluate(),wait);this.status();return;}
  this.running=true;this.cancelTimer();const fit=this.fit;let ok=false;
  try{ok=await r.select(d.target);}finally{
   this.running=false;if(!immediate)this.lastSwitch=this.now();this.quietUntil=this.now()+this.settle;
   if(ok&&fit&&this.fit===fit&&!r.dead)r.current?.engine[fit.method||'fitBounds']?.(...fit.args);
   this.lastKey=viewKey(r.getView?.());
   if(!this.dead&&r.safeMode&&this.enabled)this.disable('safe-mode');
   if(this.dirty&&!this.dead&&this.enabled){this.dirty=false;this.schedule();}
   this.status();
  }
 }
 diagnostics(){return {auto:this.enabled,autoState:this.state,autoDisabledReason:this.disabledReason,decision:this.decision,decisionReason:this.decisionReason};}
 destroy(){this.dead=true;this.cancelTimer();if(this.interval!=null)this.timers.clearInterval?.(this.interval);this.interval=null;}
}
