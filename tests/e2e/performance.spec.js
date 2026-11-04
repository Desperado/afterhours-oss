const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{await page.route('**/api/daw**',r=>r.fulfill({json:{connected:false}}));await page.goto('/');await page.locator('#performance-toggle').click();});

test('saved setups, undo/redo, temporary hold and project reload preserve sounds',async({page})=>{
 await page.evaluate(()=>AfterhoursController.change({cutoff:35,scale:'dorian'}));
 await page.locator('#performance-setup-name').fill('Night keys');await page.locator('#performance-save-setup').click();
 await page.getByRole('slider',{name:'Macro Weight',exact:true}).press('End');
 await page.locator('#performance-undo').click();expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().macros[0])).toBe(0);
 await page.locator('#performance-redo').click();expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().macros[0])).toBe(1);
 const before=await page.evaluate(()=>AfterhoursPerformance.snapshot());
 const hold=page.locator('#performance-hold');await hold.focus();await page.keyboard.down('Space');
 await page.evaluate(()=>AfterhoursController.change({cutoff:1}));
 expect(await page.evaluate(()=>AfterhoursPerformance.project().controller.cutoff)).toBe(35);
 await page.keyboard.up('Space');expect(await page.evaluate(()=>AfterhoursPerformance.snapshot())).toEqual(before);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))?.performance?.setups[0]?.name)).toBe('Night keys');
 await page.reload();expect(await page.evaluate(()=>AfterhoursController.snapshot())).toMatchObject({cutoff:35,scale:'dorian'});expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().macros[0])).toBe(1);
 await page.locator('#performance-toggle').click();await page.evaluate(()=>AfterhoursController.change({cutoff:80}));await page.locator('#performance-recall-setup').click();expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(35);
 for(const width of [390,900,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);}
 await page.locator('#performance-panel').screenshot({path:'.context/performance-studio.png'});
});

test('audio-thread recording captures audible PCM and gestures, persists, replays and prints edits',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('#performance-record').click();await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(async()=>{await AfterhoursSynth.on('take-key',60,.85);AfterhoursController.change({cutoff:58});});
 await expect.poll(()=>page.evaluate(()=>AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
 await page.evaluate(()=>AfterhoursSynth.off('take-key'));
 await page.locator('#performance-stop').click();await expect(page.locator('#performance-status')).toContainText('Take saved locally');
 const result=await page.evaluate(async()=>{const t=AfterhoursPerformanceStudio.take,b=await AfterhoursPerformanceStudio.audio.arrayBuffer(),v=new DataView(b);let peak=0;for(let i=44;i<b.byteLength;i+=2)peak=Math.max(peak,Math.abs(v.getInt16(i,true)));return {duration:t.duration,events:t.events.map(e=>e.type),rate:v.getUint32(24,true),channels:v.getUint16(22,true),peak,size:b.byteLength};});
 expect(result.duration).toBeGreaterThan(.05);expect(result.events).toEqual(expect.arrayContaining(['noteOn','noteOff','state']));expect(result.channels).toBe(2);expect(result.rate).toBeGreaterThan(20000);expect(result.peak).toBeGreaterThan(50);expect(result.size).toBeGreaterThan(44);
 await page.reload();await page.locator('#performance-toggle').click();await expect(page.locator('#performance-status')).toContainText('Last performance restored');
 const original=await page.evaluate(()=>{AfterhoursController.change({cutoff:77});AfterhoursGrooveLive.flush();return localStorage.getItem('afterhours-fm-project-v1');});
 await page.getByText('Gesture replay & editing',{exact:true}).click();
 await page.locator('#performance-replay').click();await expect.poll(()=>page.evaluate(()=>AfterhoursPerformanceStudio.replaying)).toBe(false);
 expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(77);expect(await page.evaluate(()=>localStorage.getItem('afterhours-fm-project-v1'))).toBe(original);expect(await page.evaluate(()=>AfterhoursSynth.held().length)).toBe(0);
 await page.locator('#performance-print').click();await expect(page.locator('#performance-status')).toContainText('Edited replay printed');
 expect(await page.evaluate(()=>AfterhoursPerformanceStudio.audio.size)).toBeGreaterThan(44);
 await page.getByText('Rolling capture & recording details',{exact:true}).click();
 const download=page.waitForEvent('download');await page.locator('#performance-last').click();expect((await download).suggestedFilename()).toBe('afterhours-last-60-seconds.wav');expect(errors).toEqual([]);
});

test('MIDI Learn uses pickup, persists mappings, supports sustain/expression and releases only its channel',async({page})=>{
 await page.evaluate(()=>{window.__midi={id:'test',name:'Test keys',manufacturer:'Local'};window.__cc=v=>AfterhoursLiveMIDI.receive(__midi,[0xb0,21,v]);AfterhoursController.change({cutoff:50});window.dispatchEvent(new CustomEvent('afterhours:midilearn',{detail:'controller.cutoff'}));__cc(0);});
 expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().mappings[0])).toMatchObject({cc:21,target:'controller.cutoff'});
 await page.evaluate(()=>__cc(20));expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(50);
 await page.evaluate(()=>__cc(90));expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(Math.round(90/127*100));
 await page.evaluate(()=>{AfterhoursController.change({cutoff:30});__cc(100);});expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(30);
 await page.evaluate(()=>__cc(20));expect(await page.evaluate(()=>AfterhoursController.snapshot().cutoff)).toBe(Math.round(20/127*100));
 await page.evaluate(()=>{AfterhoursLiveMIDI.receive(__midi,[0x90,60,100]);AfterhoursLiveMIDI.receive(__midi,[0x91,64,80]);});await expect.poll(()=>page.evaluate(()=>AfterhoursSynth.held().length)).toBe(2);
 await page.evaluate(()=>{AfterhoursLiveMIDI.receive(__midi,[0xb0,64,127]);AfterhoursLiveMIDI.receive(__midi,[0x80,60,0]);AfterhoursLiveMIDI.receive(__midi,[0xe0,0,96]);AfterhoursLiveMIDI.receive(__midi,[0xd0,80]);});expect(await page.evaluate(()=>AfterhoursSynth.held().length)).toBe(2);
 await page.evaluate(()=>AfterhoursLiveMIDI.receive(__midi,[0xb0,64,0]));expect(await page.evaluate(()=>AfterhoursSynth.held().map(n=>n.note))).toEqual([64]);
 await page.evaluate(()=>{AfterhoursLiveMIDI.receive(__midi,[0x90,60,100]);AfterhoursLiveMIDI.receive(__midi,[0xb0,123,0]);});expect(await page.evaluate(()=>AfterhoursSynth.held().map(n=>n.note))).toEqual([64]);
 await page.evaluate(()=>AfterhoursLiveMIDI.release());expect(await page.evaluate(()=>AfterhoursSynth.held())).toEqual([]);
 await page.evaluate(async()=>{for(let n=48;n<60;n++)await AfterhoursSynth.on('poly-'+n,n,.8);});expect(await page.evaluate(()=>AfterhoursSynth.held().map(n=>n.note))).toEqual([52,53,54,55,56,57,58,59]);await page.evaluate(()=>AfterhoursSynth.panic());
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('afterhours-fm-project-v1'))?.performance?.mappings.length)).toBe(1);await page.reload();expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().mappings[0].cc)).toBe(21);
});

test('mixer mute silences new voices and legacy echo; macros and sends produce finite audio',async({page})=>{
 const results=await page.evaluate(async()=>{
 const rms=a=>Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length),out=[];
 for(const variant of ['neutral','muted','shaped']){const p=AfterhoursPerformanceCore.validate();if(variant==='muted')p.mixer.lanes[5].mute=true;if(variant==='shaped'){p.macros=Array(8).fill(.7);p.mixer.lanes[5].reverb=.5;p.mixer.lanes[5].delay=.4;}
 const ctx=new OfflineAudioContext(2,48000,24000),audio=new FMGrooveAudio(ctx,120,AfterhoursController.defaults(),p);audio.setMix({space:1});audio.hit({lane:5,settings:{...AfterhoursGroove.project().patterns[0].tracks[5],decay:.1},velocity:.8,gate:.1,beat:0},.05);const b=await ctx.startRendering(),a=b.getChannelData(0);out.push({variant,rms:rms(a),finite:a.every(Number.isFinite)});audio.dispose();}return out;});
 expect(results[0].rms).toBeGreaterThan(.0001);expect(results[1].rms).toBeLessThan(1e-7);expect(results[2].rms).toBeGreaterThan(.0001);expect(results.every(r=>r.finite)).toBe(true);
});

test('lane echo routing follows instrument changes and transport restarts',async({page})=>{
 const result=await page.evaluate(async()=>{
   const render=async (primed,machine='Kick',restart=false)=>{
     const ctx=new OfflineAudioContext(2,48000,24000),audio=new FMGrooveAudio(ctx,120,AfterhoursController.defaults(),AfterhoursPerformanceCore.validate());
     audio.setMix({space:1});
     if(primed){audio.mixer.channel(5,false);audio.mixer.legacy(5,audio.delay);}
     if(restart)audio.stop();
     audio.hit({lane:5,settings:{...AfterhoursGroove.project().patterns[0].tracks[0],machine,note:64,decay:.1},velocity:.8,gate:.1,beat:0},.05);
     const buffer=await ctx.startRendering(),samples=Float32Array.from(buffer.getChannelData(0));audio.dispose();return samples;
   };
   const base=await render(false),primed=await render(true),fresh=await render(false,'Saw',true),restarted=await render(true,'Saw',true),rms=a=>Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length);
   return {rms:rms(base),delta:rms(base.map((x,i)=>x-primed[i])),restartRms:rms(fresh),restartDelta:rms(fresh.map((x,i)=>x-restarted[i])),finite:[primed,restarted].every(a=>a.every(Number.isFinite))};
 });
 expect(result.rms).toBeGreaterThan(.0001);expect(result.delta).toBeLessThan(1e-7);expect(result.restartRms).toBeGreaterThan(.0001);expect(result.restartDelta).toBeLessThan(1e-7);expect(result.finite).toBe(true);
});

test('scene morph queues tuning to a bar and modulation leaves the base setup intact',async({page})=>{
 await page.evaluate(()=>{AfterhoursPerformance.store.update(s=>{s.controller.cutoff=90;s.scenes[1].controller.cutoff=20;s.scenes[1].controller.scale='whole';s.scenes[1].macros[0]=.8;s.morphBars=1;});AfterhoursShell.getEngine('groove').tempo().set(240);});
 await page.locator('#transport-play').click();await expect.poll(()=>page.evaluate(()=>AfterhoursGrooveLive.clock().beat)).toBeGreaterThan(.3);
 await page.getByRole('button',{name:'Recall scene 2',exact:true}).click();expect(await page.evaluate(()=>AfterhoursController.snapshot().scale)).toBe('chromatic');
 await expect.poll(()=>page.evaluate(()=>AfterhoursController.snapshot().scale)).toBe('whole');await expect(page.locator('#performance-scene-status')).toContainText('ready');expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().macros[0])).toBeCloseTo(.8);
 await page.evaluate(()=>AfterhoursGrooveLive.stop());
 const base=await page.evaluate(()=>{AfterhoursPerformance.store.update(s=>s.mods=[{source:'sine',target:'cutoff',depth:.5,beats:1,lane:0,enabled:true}]);return AfterhoursPerformance.snapshot().controller;});
 await expect.poll(()=>page.evaluate(()=>AfterhoursPerformance.snapshot().mods[0].depth)).toBe(.5);expect(await page.evaluate(()=>AfterhoursPerformance.snapshot().controller)).toEqual(base);
});


test('failed replay printing restores the project and keeps the original WAV',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(async()=>{
   AfterhoursController.change({cutoff:70});AfterhoursPerformance.store.beginHold();AfterhoursController.change({cutoff:25});
   window.__device={id:'held-wheel',name:'Keys'};
   AfterhoursLiveMIDI.receive(__device,[0xe0,0,96]);AfterhoursLiveMIDI.receive(__device,[0xd0,64]);
   AfterhoursLiveMIDI.receive(__device,[0x90,60,100]);
 });
 await expect.poll(()=>page.evaluate(()=>AfterhoursSynth.held()[0]?.bend)).toBe(1);
 await page.locator('#performance-record').click();await expect(page.locator('#performance-record')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>AfterhoursPerformanceStudio.recording)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>AfterhoursAudio.meter().peak)).toBeGreaterThan(-60);
 await page.locator('#performance-stop').click();await expect(page.locator('#performance-status')).toContainText('Take saved locally');
 expect(await page.evaluate(()=>AfterhoursPerformanceStudio.take.initial)).toMatchObject({groove:{project:{performance:{controller:{cutoff:25}}}},held:[{bend:1,pressure:64/127}]});
 await page.evaluate(()=>{AfterhoursPerformance.store.endHold();AfterhoursLiveMIDI.release();AfterhoursGrooveLive.flush();window.__savedProject=localStorage.getItem('afterhours-fm-project-v1');window.__savedAudio=AfterhoursPerformanceStudio.audio;AfterhoursPerformanceStudio.take.duration=5;});
 await page.getByText('Gesture replay & editing',{exact:true}).click();
 await page.locator('#performance-print').click();await expect.poll(()=>page.evaluate(()=>AfterhoursPerformanceStudio.replaying)).toBe(true);
 const failure=await page.evaluate(async()=>{
   const original=AfterhoursAudio.stop;AfterhoursAudio.stop=async()=>{throw new Error('Simulated audio flush failure');};
   try{await AfterhoursPerformanceStudio.stopReplay();return null;}catch(e){return e.message;}finally{AfterhoursAudio.stop=original;}
 });
 expect(failure).toBe('Simulated audio flush failure');
 expect(await page.evaluate(()=>({replaying:AfterhoursPerformanceStudio.replaying,capturing:AfterhoursAudio.recording,cutoff:AfterhoursController.snapshot().cutoff,project:localStorage.getItem('afterhours-fm-project-v1')===__savedProject,audio:AfterhoursPerformanceStudio.audio===__savedAudio}))).toEqual({replaying:false,capturing:false,cutoff:70,project:true,audio:true});
 const invalid=await page.evaluate(()=>{const t=structuredClone(AfterhoursPerformanceStudio.take);t.initial.synth.id='unknown-patch';return JSON.stringify(t);});
 await page.locator('#performance-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(invalid)});
 await expect(page.locator('#performance-status')).toContainText('unknown synth patch');
 expect(await page.evaluate(()=>AfterhoursPerformanceStudio.audio===__savedAudio)).toBe(true);expect(errors).toEqual([]);
});
