'use client';

const KEY='pkr:foreground-sounds';
export type PkrSound='new-request'|'approved'|'update';

export function foregroundSoundsEnabled():boolean {
  if(typeof window==='undefined')return false;
  try{return localStorage.getItem(KEY)==='on';}catch{return false;}
}

export function setForegroundSoundsEnabled(enabled:boolean):void {
  try{localStorage.setItem(KEY,enabled?'on':'off');}catch{}
}

/**
 * A short, optional foreground chime. Browsers do not allow a PWA to set
 * a custom background push ringtone: those sounds follow OS settings.
 */
export function playPkrSound(kind:PkrSound='update',test=false):void {
  if(typeof window==='undefined'||(document.visibilityState!=='visible'&&!test)||
    (!test&&!foregroundSoundsEnabled()))return;
  try{
    const Audio=(window.AudioContext||(window as any).webkitAudioContext) as typeof AudioContext|undefined;
    if(!Audio)return;
    const ctx=new Audio();
    void ctx.resume().then(()=>{
      const notes=kind==='new-request'?[740,990,1175]:kind==='approved'?[660,880,1100]:[660,880];
      const start=ctx.currentTime+0.015;
      notes.forEach((hz,i)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type='sine';osc.frequency.setValueAtTime(hz,start+i*0.13);
        gain.gain.setValueAtTime(0.0001,start+i*0.13);
        gain.gain.exponentialRampToValueAtTime(0.055,start+i*0.13+0.023);
        gain.gain.exponentialRampToValueAtTime(0.0001,start+i*0.13+0.11);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(start+i*0.13);osc.stop(start+i*0.13+0.13);
      });
      window.setTimeout(()=>void ctx.close().catch(()=>{}),900);
    }).catch(()=>void ctx.close().catch(()=>{}));
  }catch{/* Missing Web Audio or autoplay protection: always fail quietly. */}
}
