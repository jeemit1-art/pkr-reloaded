'use client';

const KEY='pkr:foreground-sounds';
export type PkrSound='new-request'|'approved'|'update';

export function foregroundSoundsEnabled():boolean {
  if(typeof window==='undefined')return false;
  // Opted-out listeners stay muted across deployments. For new installs,
  // meaningful foreground alerts are enabled by default.
  try{return localStorage.getItem(KEY)!=='off';}catch{return false;}
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
      // Higher-presence foreground alert, without controlling the phone's
      // system notification volume (which browsers and PWAs cannot change).
      const notes=kind==='new-request'?[784,1047,1319,1568]:
        kind==='approved'?[659,880,1175]:[698,932,1175];
      const start=ctx.currentTime+0.015;
      const peak=kind==='new-request'?0.18:0.13;
      notes.forEach((hz,i)=>{
        const at=start+i*0.17;
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type='triangle';osc.frequency.setValueAtTime(hz,at);
        gain.gain.setValueAtTime(0.0001,at);
        gain.gain.exponentialRampToValueAtTime(peak,at+0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001,at+0.15);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(at);osc.stop(at+0.16);
      });
      window.setTimeout(()=>void ctx.close().catch(()=>{}),1400);
    }).catch(()=>void ctx.close().catch(()=>{}));
  }catch{/* Missing Web Audio or autoplay protection: always fail quietly. */}
}
