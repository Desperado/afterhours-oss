const {test,expect}=require('@playwright/test');

test.beforeEach(async({page})=>{
  await page.route('**/api/daw**',r=>r.fulfill({json:{connected:false}}));
  await page.goto('/');
  await page.locator('#performance-toggle').click();
});

test('two named takes and their parts survive reload; selected parts play and loop independently',async({page})=>{
  await expect(page.getByLabel('Saved performances',{exact:true})).toHaveCount(1);
  for(const name of ['Night drive','Warm ending']){
    await page.getByLabel('Next take name',{exact:true}).fill(name);
    await page.locator('#performance-record').click();
    await page.evaluate(async()=>{window.__takeStart=AfterhoursAudio.context().currentTime;await AfterhoursSynth.on('library-note',60,.8);});
    await expect.poll(()=>page.evaluate(()=>AfterhoursAudio.context().currentTime-window.__takeStart)).toBeGreaterThan(2);
    await page.evaluate(()=>AfterhoursSynth.off('library-note'));
    await page.locator('#performance-stop').click();
    await expect(page.locator('#performance-status')).toContainText('Take saved locally');
  }
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(2);
  const first=await page.getByLabel('Saved performances',{exact:true}).locator('option').filter({hasText:'Night drive'}).getAttribute('value');
  await page.getByLabel('Saved performances',{exact:true}).selectOption(first);
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Night drive');
  await page.getByText('Name or edit parts',{exact:true}).click();
  await page.getByLabel('Part name',{exact:true}).fill('Intro');
  await page.getByLabel('Part start (seconds)',{exact:true}).fill('0.2');
  await page.getByLabel('Part end (seconds)',{exact:true}).fill('0.6');
  await page.getByRole('button',{name:'Save part',exact:true}).click();
  await expect(page.getByLabel('Playback part',{exact:true}).locator('option')).toHaveCount(2);
  await page.reload();await page.locator('#performance-toggle').click();
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Night drive');
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(2);
  const intro=await page.getByLabel('Playback part',{exact:true}).locator('option').filter({hasText:'Intro'}).getAttribute('value');
  await page.getByLabel('Playback part',{exact:true}).selectOption(intro);
  await page.getByRole('button',{name:'Loop selected part',exact:true}).click();
  await page.getByRole('button',{name:'Play selected part',exact:true}).click();
  await expect.poll(()=>page.locator('#performance-player').evaluate(p=>!p.paused&&p.currentTime>=.19&&p.currentTime<.65)).toBe(true);
  await page.locator('#performance-player').evaluate(p=>p.currentTime=.59);
  await expect.poll(()=>page.locator('#performance-player').evaluate(p=>!p.paused&&p.currentTime<.45)).toBe(true);
  await page.getByRole('button',{name:'Stop playback',exact:true}).click();
  await expect.poll(()=>page.locator('#performance-player').evaluate(p=>p.paused)).toBe(true);
  await page.getByText('Gesture replay & editing',{exact:true}).click();
  const originalAudio=await page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await AfterhoursPerformanceStudio.audio.arrayBuffer()))));
  await page.locator('#performance-print').click();
  await expect(page.locator('#performance-status')).toContainText('original recording kept');
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(3);
  await page.getByLabel('Saved performances',{exact:true}).selectOption(first);
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Night drive');
  expect(await page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await AfterhoursPerformanceStudio.audio.arrayBuffer()))))).toEqual(originalAudio);
  await page.getByLabel('Saved performances',{exact:true}).selectOption({label:await page.getByLabel('Saved performances',{exact:true}).locator('option').filter({hasText:'Warm ending'}).textContent()});
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Warm ending');
  await expect(page.getByLabel('Playback part',{exact:true}).locator('option')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:'.context/performance-library-phone.png'});
});

test('the previous single take migrates with its WAV and deleting it preserves another take',async({page})=>{
  const initial=await page.evaluate(()=>({groove:AfterhoursGrooveLive.snapshot(),synth:AfterhoursSynth.snapshot()}));
  await page.goto('/favicon.svg');
  await page.evaluate(async initial=>{
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('afterhours-performances');r.onsuccess=resolve;r.onerror=reject;});
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('afterhours-performances',1);r.onupgradeneeded=()=>r.result.createObjectStore('takes');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
    const bytes=new ArrayBuffer(16044),v=new DataView(bytes),str=(offset,s)=>[...s].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,16036,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,16000,true);
    await new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');tx.objectStore('takes').put({take:{version:1,kind:'afterhours-performance',name:'Legacy night',duration:1,initial,events:[]},audio:new Blob([bytes],{type:'audio/wav'})},'latest');tx.oncomplete=resolve;tx.onerror=reject;});db.close();
  },initial);
  await page.goto('/');await page.locator('#performance-toggle').click();
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Legacy night');
  expect(await page.evaluate(()=>AfterhoursPerformanceStudio.audio.size)).toBe(16044);
  const legacy=await page.getByLabel('Saved performances',{exact:true}).inputValue();
  const imported=await page.evaluate(()=>JSON.stringify({...AfterhoursPerformanceStudio.take,name:'Imported gestures',parts:[{id:'intro',name:'Intro',start:0,end:.5}]}));
  await page.locator('#performance-file').setInputFiles({name:'take.json',mimeType:'application/json',buffer:Buffer.from(imported)});
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(2);
  await expect(page.locator('#performance-audio-hint')).toContainText('Gestures only');
  await expect(page.getByRole('button',{name:'Play take',exact:true})).toBeDisabled();
  await page.getByLabel('Saved performances',{exact:true}).selectOption(legacy);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#performance-delete-take').click();
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(2);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#performance-delete-take').click();
  await expect(page.getByLabel('Saved performances',{exact:true}).locator('option')).toHaveCount(1);
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Imported gestures');
  await expect(page.getByLabel('Playback part',{exact:true}).locator('option')).toHaveCount(2);
  await page.reload();await page.locator('#performance-toggle').click();
  await expect(page.getByLabel('Take name',{exact:true})).toHaveValue('Imported gestures');
});
