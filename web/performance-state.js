'use strict';
// The project owns the base state. Fast modulation never writes into it.
window.AfterhoursPerformance = (() => {
  const Core=AfterhoursPerformanceCore,C=AfterhoursController,store=new Core.Store(),targets=new Map();
  let applying=false;
  store.subscribe((s,reason)=>{applying=true;try{C.change({...s.controller,bend:reason==='load'?0:C.snapshot().bend});C.setTarget(s.controllerTarget);}finally{applying=false;}});
  C.subscribe(s=>{if(!applying){const next=Core.controller(s),keys=Object.keys(next).filter(k=>next[k]!==store.state.controller[k]);store.update(v=>{v.controller=next;},'controller-'+keys.join('-'));}});
  return {store,targets,core:Core,register(id,target){targets.set(id,target);},
    load:raw=>store.load(raw),snapshot:()=>store.snapshot(),project:()=>store.project(),
    event(type,value){window.dispatchEvent(new CustomEvent('afterhours:gesture',{detail:{type,value}}));}};
})();
