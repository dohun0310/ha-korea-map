import {test} from 'node:test';import assert from 'node:assert/strict';
const make=()=>({style:{},children:[],listeners:{},append(...xs){this.children.push(...xs)},addEventListener(n,fn){this.listeners[n]=fn},remove(){this.removed=true}});
test('official map exposes explicit safe recovery/resume UI without covering attribution',async()=>{
 const mod=await import('../config/www/ha-map-controls.mjs').catch(()=>({}));assert.equal(typeof mod.mountControls,'function','explicit controls missing');
 const parent=make(),doc={createElement:make};let recovered=0,resumed;
 const router={desired:'naver',diagnostics:()=>({provider:'native',safeMode:true,reason:'provider-failed'}),recover:async()=>recovered++,resume:async p=>resumed=p};
 const ui=mod.mountControls(router,{parent,document:doc,allowed:['naver']});assert.equal(ui.element.style.top,'8px');assert.equal(ui.element.style.bottom,undefined);assert.match(ui.status.textContent,/안전/);await ui.recover.listeners.click();assert.equal(recovered,1);await ui.resume.listeners.click();assert.equal(resumed,'naver');ui.remove();assert.equal(ui.element.removed,true);
});
test('select box follows the actual router provider, not the configured one',async()=>{
 const {mountControls}=await import('../config/www/ha-map-controls.mjs');const parent=make();let d={provider:'google',safeMode:false,auto:false};
 const router={desired:'google',diagnostics:()=>d,recover:async()=>{},resume:async()=>{}};const ui=mountControls(router,{parent,document:{createElement:make},allowed:['naver','google']});
 assert.equal(ui.select.value,'google');d={...d,provider:'naver'};router.onStatus();assert.equal(ui.select.value,'naver');assert.equal(ui.selectedText(),'NAVER');ui.remove();
});
test('auto option shows the current engine and changing the select chooses immediately',async()=>{
 const {mountControls}=await import('../config/www/ha-map-controls.mjs');const parent=make();let d={provider:'naver',safeMode:false,auto:true,decision:'korea'},chosen=[];
 const router={desired:'auto',auto:{},diagnostics:()=>d,recover:async()=>{},resume:async()=>{},choose:async v=>{chosen.push(v);d={...d,auto:v==='auto',provider:v==='auto'?d.provider:v};}};
 const ui=mountControls(router,{parent,document:{createElement:make},allowed:['naver','google']});
 assert.deepEqual(ui.select.children.map(o=>o.value),['auto','native','naver','google']);assert.equal(ui.select.value,'auto');assert.equal(ui.selectedText(),'자동 (NAVER)');
 d={...d,provider:'google',decision:'overseas'};router.onStatus();assert.equal(ui.selectedText(),'자동 (Google)');
 ui.select.value='naver';await ui.select.listeners.change();assert.deepEqual(chosen,['naver']);assert.equal(ui.select.value,'naver');assert.equal(ui.selectedText(),'NAVER');
 ui.select.value='auto';await ui.select.listeners.change();assert.deepEqual(chosen,['naver','auto']);assert.equal(ui.select.value,'auto');assert.equal(ui.selectedText(),'자동 (NAVER)');ui.remove();
});
