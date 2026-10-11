import {test} from 'node:test';import assert from 'node:assert/strict';
import * as extension from '../config/www/ha-map-extension.mjs';
const {installHook,ownsDefaultPanel}=extension;
import {existsSync} from 'node:fs';
// The generated lab config holds browser keys and is never committed; its check runs only where it exists.
const labConfigUrl=new URL('../config/www/ha-map-lab-config.mjs',import.meta.url);
const labConfig=existsSync(labConfigUrl)?(await import(labConfigUrl.href)).labConfig:null;
if(labConfig)await import('../config/www/ha-map-lab-bootstrap.mjs');
test('deployed lab configuration is native or explicitly opted-in official with known pins',{skip:!labConfig&&'generated lab config absent (not committed)'},()=>{assert.ok(labConfig.mode==='native'||(labConfig.mode==='official'&&['naver','google'].includes(labConfig.provider)&&labConfig.providers[labConfig.provider]?.optIn===true)||(labConfig.mode==='official'&&labConfig.provider==='auto'&&labConfig.providers.naver?.optIn===true&&labConfig.providers.google?.optIn===true&&/^\/local\/ha-map-korea-boundary\.geojson\?v=/.test(labConfig.boundary?.url)));assert.equal(labConfig.pin.coreVersion,'2026.10.1');assert.equal(labConfig.pin.frontendVersion,'20260930.3')});
test('auto provider requires both opted-in keys plus boundary and manual select disables auto',async()=>{
 const both={naver:{key:'unit-public-naver',optIn:true},google:{key:'unit-public-google',optIn:true}};let fetched=0;const fetch=async()=>{fetched++;return {ok:false}};
 for(const [providers,boundary] of [[{naver:both.naver},{url:'/local/b.geojson'}],[both,undefined]]){const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'official',provider:'auto',providers,boundary,fetch,pathname:()=>'/map/0'});const m=new C();m.parentNode=dashboard();m.clusterMarkers=false;assert.equal((await m._createEngine()).select,undefined);ctl.uninstall();}
 const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'official',provider:'auto',providers:both,boundary:{url:'/local/b.geojson'},fetch,pathname:()=>'/map/0'});const m=new C();m.parentNode=dashboard();m.clusterMarkers=false;const engine=await m._createEngine();
 assert.equal(typeof engine.choose,'function');assert.equal(engine.desired,'auto');assert.equal(ctl.diagnostics().routers[0].auto,true);assert.equal(ctl.diagnostics().provider,'auto');assert.doesNotMatch(JSON.stringify(ctl.diagnostics()),/unit-public/);
 let chosen;engine.choose=async v=>{chosen=v;return true};await ctl.select('google');assert.equal(chosen,'google');await ctl.auto();assert.equal(chosen,'auto');
 for(const k of ['setView','fitBounds','panTo'])assert.equal(typeof ctl[k],'function',k);engine.destroy();ctl.uninstall();
});
test('mock ownership is evaluated at factory time and excludes other dashboard',async()=>{
 for(const [path,owner,flag,expected] of [['/map/0',dashboard(),null,'mock'],['/other/0',dashboard('other'),null,undefined],['/map/0',dashboard(), '_forceLeaflet',undefined],['/map/0',dashboard(),'rasterOnly',undefined]]){
 const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'mock',pathname:()=>path});const m=new C();m.parentNode=owner;if(flag)m[flag]=true;assert.equal((await m._createEngine()).labAdapter,expected);ctl.uninstall();
 }
});
test('mock init failure recovers native init and preserves destroy',async()=>{
 const C=fixture(),events=[],ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'mock-init-failure',pathname:()=>'/map/0',events});const m=new C();m.parentNode=dashboard();const engine=await m._createEngine();await engine.init({dataset:{}},{});engine.destroy();assert.deepEqual(events.map(e=>e.type),['adapter-init','mock-failed-native-recovery','destroy']);ctl.uninstall();
});
test('uninstall does not overwrite later third-party factory patch',()=>{
 const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3'}),later=()=>{};C.prototype._createEngine=later;ctl.uninstall();assert.equal(C.prototype._createEngine,later);
});
const pin={coreVersion:'2026.10.1',frontendVersion:'20260930.3',entrypoints:['/frontend_latest/core.ecb6c9be4886db2c.js','/frontend_latest/app.6234b2ff06eb162a.js']};
const origin='http://lab.test';
const preloads=pin.entrypoints.map(path=>({href:origin+path}));
const resources=pin.entrypoints.map(path=>({name:origin+path}));
function autoEnvironment(coreVersion='2026.10.1'){
 const C=fixture(),app={hass:coreVersion?{config:{version:coreVersion}}:undefined};
 const document={querySelector:()=>app,querySelectorAll:()=>preloads};
 const registry={get:()=>C,whenDefined:()=>Promise.resolve()};
 return {C,app,document,registry,performance:{getEntriesByType:()=>resources},location:{origin,pathname:'/map/0'}};
}
test('auto hook polls for real hass version then installs explicit lab mock',async()=>{
 assert.equal(typeof extension.startAutoHook,'function');
 const env=autoEnvironment(null);let waits=0;
 const ctl=await extension.startAutoHook({...env,config:{pin,mode:'mock'},maxAttempts:3,sleep:async()=>{waits++;env.app.hass={config:{version:'2026.10.1'}}}});
 assert.equal(waits,1);assert.equal(ctl.installed,true);
 const map=new env.C();map.parentNode=dashboard();const engine=await map._createEngine();assert.equal(engine.labAdapter,'mock');const container={dataset:{}};await engine.init(container,{});assert.equal(container.dataset.haMapLab,'mock-native-backed');ctl.uninstall();
});
test('auto hook keeps polling when ha-map shape is incomplete at first sight, then installs',async()=>{
 const env=autoEnvironment();const load=env.C.prototype._loadMap;delete env.C.prototype._loadMap;let waits=0;
 const ctl=await extension.startAutoHook({...env,config:{pin,mode:'mock'},maxAttempts:5,sleep:async()=>{waits++;env.C.prototype._loadMap=load;}});
 assert.equal(ctl.installed,true,'shape mismatch must not be a final verdict while polling');assert.equal(waits,1);ctl.uninstall();
});
test('auto hook reports which shape check failed when it never matches',async()=>{
 const env=autoEnvironment();delete env.C.prototype._loadMap;
 const ctl=await extension.startAutoHook({...env,config:{pin},maxAttempts:2,sleep:async()=>{}});
 assert.equal(ctl.installed,false);assert.match(ctl.reason,/unknown version\/method shape: .*_loadMap/);
});
test('auto hook times out without modifying prototype and ignores late definition',async()=>{
 assert.equal(typeof extension.startAutoHook,'function');
 const env=autoEnvironment(null),old=env.C.prototype._createEngine;let waits=0,defined;
 env.registry={get:()=>undefined,whenDefined:()=>new Promise(resolve=>{defined=resolve})};
 const ctl=await extension.startAutoHook({...env,config:{pin},maxAttempts:2,sleep:async()=>{waits++}});
 assert.equal(ctl.installed,false);assert.equal(waits,2);env.app.hass={config:{version:'2026.10.1'}};env.registry.get=()=>env.C;defined();await Promise.resolve();assert.equal(env.C.prototype._createEngine,old);
});
test('auto hook rejects unknown core and mismatched active frontend',async()=>{
 assert.equal(typeof extension.startAutoHook,'function');
 for(const env of [autoEnvironment('2026.11.0'),{...autoEnvironment(),performance:{getEntriesByType:()=>[]}}]){
 const old=env.C.prototype._createEngine;const ctl=await extension.startAutoHook({...env,config:{pin},maxAttempts:1,sleep:async()=>{}});assert.equal(ctl.installed,false);assert.equal(env.C.prototype._createEngine,old);
 }
});
test('auto hook native mode remains the default without opt in',async()=>{
 assert.equal(typeof extension.startAutoHook,'function');
 const env=autoEnvironment();const ctl=await extension.startAutoHook({...env,config:{pin},sleep:async()=>{}});const map=new env.C();map.parentNode=dashboard();assert.equal((await map._createEngine()).labAdapter,undefined);ctl.uninstall();
});
test('frontend identity requires exact active entries plus HTML preloads',()=>assert.equal(extension.detectFrontendVersion?.({pin,origin,preloads,resources}),'20260930.3'));
test('frontend identity excludes missing, foreign and changed hashes',()=>{
 for(const changed of [[],resources.slice(0,1),[{name:'https://other.test'+pin.entrypoints[0]},resources[1]],[{name:origin+'/frontend_latest/core.unknown.js'},resources[1]]])assert.equal(extension.detectFrontendVersion?.({pin,origin,preloads,resources:changed}),undefined);
 assert.equal(extension.detectFrontendVersion?.({pin,origin,preloads:[],resources}),undefined);
});
function fixture(){class Map{async _createEngine(){return {init:async()=>{},destroy(){},addMarker(){}}}_setUpEngine(){}_loadMap(){} disconnectedCallback(){}}return Map}
test('official hook creates stable router only within owned dashboard and opt-in key',async()=>{
 const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'official',provider:'naver',providers:{naver:{key:'unit-public-key',optIn:true}},pathname:()=>'/map/0'});const m=new C();m.parentNode=dashboard();m.clusterMarkers=false;const engine=await m._createEngine();assert.equal(typeof engine.select,'function','official router missing');assert.equal(ctl.diagnostics().routers.length,1);engine.destroy();assert.equal(ctl.diagnostics().routers.length,0);ctl.uninstall();
});
test('official missing key stays native and exposes no credentials',async()=>{
 const C=fixture(),ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'official',provider:'google',providers:{google:{optIn:true}},pathname:()=>'/map/0'});const m=new C();m.parentNode=dashboard();assert.equal((await m._createEngine()).select,undefined);assert.equal(ctl.diagnostics().routers.length,0);ctl.uninstall();
});
const panel={localName:'ha-panel-map',route:{path:'/map'},parentNode:null};
function dashboard(url_path='map'){
 const owner={localName:'ha-panel-lovelace',panel:{url_path},parentNode:null};
 const root={localName:'hui-root',parentNode:owner};
 const card={localName:'hui-map-card',getRootNode:()=>({host:root})};
 return {getRootNode:()=>({host:card})};
}
test('actual /map/0 dashboard owns map through shadow hosts',()=>assert.equal(ownsDefaultPanel(dashboard(),'/map/0'),true));
test('map dashboard bare route is allowed',()=>assert.equal(ownsDefaultPanel(dashboard(),'/map'),true));
test('other dashboard and unknown panel metadata are excluded',()=>{assert.equal(ownsDefaultPanel(dashboard('other'),'/other/0'),false);assert.equal(ownsDefaultPanel(dashboard('other'),'/map/0'),false);assert.equal(ownsDefaultPanel(dashboard(undefined),'/other/0'),false);assert.equal(ownsDefaultPanel(dashboard(null),'/map/0'),false)});
test('zone editor wrapping default dashboard stays excluded',()=>{const map=dashboard();assert.equal(ownsDefaultPanel({parentNode:{localName:'ha-locations-editor',parentNode:map}},'/map/0'),false)});
test('unrelated lovelace map without hui-map-card is excluded',()=>assert.equal(ownsDefaultPanel({parentNode:{localName:'ha-panel-lovelace',panel:{url_path:'map'}}},'/map/0'),false));
test('legacy panel cannot hide a locations editor ancestor',()=>assert.equal(ownsDefaultPanel({parentNode:{localName:'ha-panel-map',parentNode:{localName:'ha-locations-editor'}}},'/map'),false));
test('unknown core fails closed',()=>assert.equal(installHook(fixture(),{coreVersion:'next',frontendVersion:'20260930.3'}).installed,false));
test('panel ownership excludes editor',()=>{assert.equal(ownsDefaultPanel({parentNode:panel},'/map'),true);assert.equal(ownsDefaultPanel({parentNode:{localName:'ha-locations-editor'}},'/map'),false);assert.equal(ownsDefaultPanel({parentNode:panel},'/config/zone'),false)});
test('factory exact restoration and native default',async()=>{const C=fixture(),old=C.prototype._createEngine;const ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',pathname:()=>'/map'});assert.ok(ctl.installed);const m=new C();m.parentNode=panel;const e=await m._createEngine();assert.equal(e.labAdapter,undefined);ctl.uninstall();assert.equal(C.prototype._createEngine,old)});
test('auto mode mounts no selector or status UI on the map',async()=>{
 const appended=[];const C=fixture();let fetched=0;const fetch=async()=>{fetched++;return {ok:false}};
 const ctl=installHook(C,{coreVersion:'2026.10.1',frontendVersion:'20260930.3',mode:'official',provider:'auto',providers:{naver:{key:'unit-public-naver',optIn:true},google:{key:'unit-public-google',optIn:true}},boundary:{url:'/local/b.geojson'},fetch,pathname:()=>'/map/0'});
 const m=new C();m.parentNode=dashboard();m.clusterMarkers=false;const engine=await m._createEngine();
 const el=()=>({style:{},dataset:{},append(...x){appended.push(...x)},appendChild(x){appended.push(x)},remove(){},addEventListener(){},ownerDocument:{createElement:()=>el()}});
 await engine.init(el(),{center:[37.5,127],zoom:10,events:{}}).catch(()=>{});
 assert.equal(appended.some(x=>x?.children?.some?.(c=>c?.tagName==='SELECT')||x?.tagName==='SELECT'),false);assert.equal(engine.ui,undefined,'no controls object');
 assert.equal('control' in (ctl.diagnostics().routers[0]||{}),false);engine.destroy();ctl.uninstall();
});
