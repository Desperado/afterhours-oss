'use strict';
/* Audio stays out of project JSON. A small index lists takes without loading
   every WAV; each write updates the audio and its index atomically. */
window.AfterhoursTakeLibrary = (() => {
  let opening;
  const metadata = r => ({id:r.id,name:r.take.name,duration:r.take.duration,
    createdAt:r.createdAt,updatedAt:r.updatedAt,hasAudio:r.audio instanceof Blob,parts:r.take.parts?.length||0});
  function database() {
    return opening ||= new Promise((resolve,reject)=>{
      const request=indexedDB.open('afterhours-performances',2);
      request.onupgradeneeded=()=>{
        const db=request.result,tx=request.transaction;
        if(!db.objectStoreNames.contains('takes'))db.createObjectStore('takes');
        db.createObjectStore('entries',{keyPath:'id'});db.createObjectStore('settings');
        const takes=tx.objectStore('takes'),old=takes.get('latest');
        old.onsuccess=()=>{
          if(!old.result?.take)return;
          const record={...old.result,id:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now()};
          takes.put(record,record.id);tx.objectStore('entries').put(metadata(record));
          tx.objectStore('settings').put(record.id,'active');takes.delete('latest');
        };
      };
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>{opening=null;reject(new Error('Take library unavailable · export your recording before closing'));};
      request.onblocked=()=>window.AfterhoursShell.status('Close other AFTERHOURS windows to upgrade the take library','err');
    });
  }
  async function transaction(mode,fn) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['takes','entries','settings'],mode),result=fn(tx);
      tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
      tx.onerror=()=>reject(new Error(mode==='readwrite'?'Take could not be saved · export it before closing':'Could not read the take library'));
      tx.onabort=()=>reject(new Error('Take library operation failed · existing recordings were kept'));
    });
  }
  return {
    create:(take,audio,extra={})=>({...extra,id:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now(),take,audio}),
    list:()=>transaction('readonly',tx=>{const r=tx.objectStore('entries').getAll();return()=>r.result.sort((a,b)=>b.createdAt-a.createdAt);}),
    load:id=>transaction('readonly',tx=>{const r=tx.objectStore('takes').get(id);return()=>r.result;}),
    active:()=>transaction('readonly',tx=>{const r=tx.objectStore('settings').get('active');return()=>r.result;}),
    select:id=>transaction('readwrite',tx=>tx.objectStore('settings').put(id,'active')),
    save:r=>transaction('readwrite',tx=>{
      const record={...r,updatedAt:Date.now()};tx.objectStore('takes').put(record,r.id);
      tx.objectStore('entries').put(metadata(record));tx.objectStore('settings').put(r.id,'active');
    }),
    remove:id=>transaction('readwrite',tx=>{
      tx.objectStore('takes').delete(id);tx.objectStore('entries').delete(id);tx.objectStore('settings').delete('active');
    }),
  };
})();
