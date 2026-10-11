// Local lab controls. Provider logos/attribution at the bottom remain untouched.
// The select always mirrors the router's ACTUAL provider (or '자동 (현재 엔진)'),
// re-synced on every router status change. It was previously set once from config.
const LABELS={native:'기본 지도',naver:'NAVER',google:'Google'};
export function mountControls(router,{parent,document=globalThis.document,allowed=[]}={}){
 const element=document.createElement('div'),select=document.createElement('select'),status=document.createElement('span'),recover=document.createElement('button'),resume=document.createElement('button');
 Object.assign(element.style,{position:'absolute',top:'8px',right:'8px',zIndex:'1000',display:'flex',gap:'4px',alignItems:'center',flexWrap:'wrap',maxWidth:'calc(100% - 70px)',background:'var(--card-background-color, white)',color:'var(--primary-text-color, black)',padding:'4px',borderRadius:'4px',fontSize:'12px'});
 const options={};
 for(const provider of [...(router.auto?['auto']:[]),'native',...allowed]){const option=document.createElement('option');option.value=provider;option.textContent=provider==='auto'?'자동':LABELS[provider];options[provider]=option;select.append(option);}
 recover.textContent='기본 지도 복구';resume.textContent='선택 지도 재개';recover.type=resume.type='button';select.title='외부 지도 SDK 사용 시 위치 전송과 과금이 발생할 수 있습니다';
 const shown=d=>{if(d.auto&&options.auto)return 'auto';if(d.pending&&options[router.desired]&&router.desired!=='auto')return router.desired;return options[d.provider]?d.provider:'native';};
 const update=()=>{const d=router.diagnostics();
  if(options.auto)options.auto.textContent=d.auto?`자동 (${LABELS[d.provider]||d.provider})`:'자동';
  select.value=shown(d);
  status.textContent=`${d.provider}${d.auto?' · 자동':''}${d.safeMode?' · 안전 모드':''}${d.autoState==='boundary-unavailable'?' · 경계 파일 없음(자동 꺼짐)':''}${d.reason==='clustering-requires-native'?' · 클러스터링은 기본 지도 전용':''}`;};
 const action=fn=>async()=>{recover.disabled=resume.disabled=select.disabled=true;try{await fn();}catch{status.textContent='기본 지도 복구 실패 · 새로고침 필요';}finally{recover.disabled=resume.disabled=select.disabled=false;update();}};
 recover.addEventListener('click',action(()=>router.recover()));
 resume.addEventListener('click',action(()=>{const want=router.desired||select.value;return want==='native'?router.recover():router.resume(want);}));
 select.addEventListener('change',action(()=>{const v=select.value;if(router.choose)return router.choose(v);return v==='native'?router.recover():router.resume(v);}));
 for(const name of ['pointerdown','click','dblclick'])element.addEventListener(name,e=>e.stopPropagation());
 element.append(select,recover,resume,status);parent.append(element);const previous=router.onStatus;router.onStatus=()=>{previous?.();update();};update();
 const selectedText=()=>options[select.value]?.textContent??'';
 return {element,select,status,recover,resume,selectedText,update,remove(){element.remove();router.onStatus=previous;}};
}
