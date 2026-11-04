'use strict';
/* Per-lane channels and two shared sends. The default graph has unity gain. */
class AfterhoursMixer {
  constructor(ctx, drums, music, bpm) {
    this.ctx=ctx;this.outputs={drums,music};this.channels=new Map();this.bpm=bpm;
    this.send=ctx.createGain();this.return=ctx.createGain();this.return.gain.value=.35;this.return.connect(music);
    this.feedback=ctx.createGain();this.feedback.gain.value=.28;this.echoTone=ctx.createBiquadFilter();this.echoTone.frequency.value=3200;
    this.echoTone.connect(this.feedback);this.echoTone.connect(this.return);
    this.verbSend=ctx.createGain();this.verbReturn=ctx.createGain();this.verbReturn.gain.value=.45;this.verbReturn.connect(music);
    this.impulse=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*1.6),ctx.sampleRate);let seed=42;
    for(let c=0;c<2;c++){const a=this.impulse.getChannelData(c);for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a[i]=(seed/2147483648-1)*(1-i/a.length)**3;}}
    this.clearTail();this.state=AfterhoursPerformanceCore.validate();
  }
  clearTail() {
    this.send.disconnect();this.feedback.disconnect();this.echo?.disconnect();this.verbSend.disconnect();this.verb?.disconnect();
    this.echo=this.ctx.createDelay(2);this.echo.delayTime.value=Math.min(1.8,60/this.bpm*.75);
    this.send.connect(this.echo).connect(this.echoTone);this.feedback.connect(this.echo);
    this.verb=this.ctx.createConvolver();this.verb.buffer=this.impulse;this.verbSend.connect(this.verb).connect(this.verbReturn);
  }
  strip() {
    const ctx=this.ctx,gain=()=>ctx.createGain(),c={input:gain(),low:ctx.createBiquadFilter(),mid:ctx.createBiquadFilter(),high:ctx.createBiquadFilter(),pan:ctx.createStereoPanner(),amp:gain(),dry:gain(),dirty:gain(),shape:ctx.createWaveShaper()};
    c.low.type='lowshelf';c.low.frequency.value=180;c.mid.type='peaking';c.mid.frequency.value=1000;c.mid.Q.value=.7;c.high.type='highshelf';c.high.frequency.value=5000;
    c.shape.curve=Float32Array.from({length:1025},(_,i)=>Math.tanh((i/512-1)*5)/Math.tanh(5));c.shape.oversample='2x';
    c.input.connect(c.low).connect(c.mid).connect(c.high);c.high.connect(c.dry).connect(c.pan);c.high.connect(c.shape).connect(c.dirty).connect(c.pan);c.pan.connect(c.amp);
    return c;
  }
  channel(index,percussion) {
    let c=this.channels.get(index);
    if(!c) {
      const ctx=this.ctx,gain=()=>ctx.createGain();
      c={...this.strip(),delay:gain(),reverb:gain(),meter:ctx.createAnalyser(),samples:new Float32Array(256)};
      c.meter.fftSize=256;c.amp.connect(c.meter);c.amp.connect(c.delay).connect(this.send);c.amp.connect(c.reverb).connect(this.verbSend);
      this.channels.set(index,c);this.applyChannel(index,c,true);
    }
    const group=percussion?'drums':'music';
    if(c.group!==group){c.meter.disconnect();c.meter.connect(this.outputs[group]);c.group=group;}
    return c.input;
  }
  legacy(index, destination) {
    const c=this.channels.get(index);
    if(!c.legacy){c.legacy=this.strip();this.applyChannel(index,c.legacy,true);}
    if(c.legacyDestination!==destination){c.legacy.amp.disconnect();c.legacy.amp.connect(destination);c.legacyDestination=destination;}
    return c.legacy.input;
  }

  applyChannel(index,c,immediate=false) {
    const p=this.state.mixer.lanes[index],selected=this.state.targets.includes(index),m=this.state.macros;
    const set=(a,v)=>immediate?a.setValueAtTime(v,this.ctx.currentTime):a.setTargetAtTime(v,this.ctx.currentTime,.02),solo=this.state.mixer.lanes.some(l=>l.solo);
    set(c.amp.gain,p.mute || (solo&&!p.solo)?0:p.level);set(c.pan.pan,p.pan);
    set(c.low.gain,p.low+(selected?m[0]*4:0));set(c.mid.gain,p.mid);set(c.high.gain,p.high+(selected?m[4]*3:0));
    const bite=selected?m[1]*.65:0;set(c.dry.gain,1-bite);set(c.dirty.gain,bite);
    if(c.legacy)this.applyChannel(index,c.legacy,immediate);
    if(c.delay)set(c.delay.gain,Math.min(1,p.delay+(selected?m[6]*.35:0)));if(c.reverb)set(c.reverb.gain,Math.min(1,p.reverb+(selected?m[6]*.5:0)));
  }
  apply(state,bpm) {this.state=state;this.bpm=bpm;this.echo.delayTime.setTargetAtTime(Math.min(1.8,60/bpm*.75),this.ctx.currentTime,.03);for(const [i,c]of this.channels)this.applyChannel(i,c);}
  levels() {return Array.from({length:16},(_,i)=>{const c=this.channels.get(i);if(!c)return 0;c.meter.getFloatTimeDomainData(c.samples);let peak=0;for(const x of c.samples)peak=Math.max(peak,Math.abs(x));return peak;});}
  dispose() {for(const c of this.channels.values())for(const strip of [c,c.legacy].filter(Boolean))for(const n of Object.values(strip))if(n && typeof n.disconnect==='function')n.disconnect();for(const n of [this.send,this.return,this.feedback,this.echoTone,this.echo,this.verbSend,this.verbReturn,this.verb])n.disconnect();this.channels.clear();}
}
window.AfterhoursMixer=AfterhoursMixer;
