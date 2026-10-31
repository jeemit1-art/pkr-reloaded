import type {ShareScore} from './whatsapp-sharing';

type CardDetails={room:string;date:string;players:ShareScore[];includeAmounts:boolean};

const amt=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(cents/100);
const name=(value:string)=>value.replace(/\s+/g,' ').trim();

function fit(ctx:CanvasRenderingContext2D,value:string,maxWidth:number):string {
  const text=name(value);
  if(ctx.measureText(text).width<=maxWidth)return text;
  let out=text;
  while(out.length>1&&ctx.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);
  return out+'…';
}
export async function createPkrResultsImage(details:CardDetails):Promise<Blob> {
  const canvas=document.createElement('canvas');
  canvas.width=1080;canvas.height=1350;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Image generation is unavailable on this device.');
  const bg=ctx.createLinearGradient(0,0,1080,1350);
  bg.addColorStop(0,'#12372c');bg.addColorStop(1,'#071815');
  ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1350);
  ctx.strokeStyle='rgba(218,177,99,.7)';ctx.lineWidth=3;
  ctx.strokeRect(44,44,992,1262);
  ctx.strokeStyle='rgba(218,177,99,.2)';ctx.lineWidth=1;
  ctx.strokeRect(58,58,964,1234);

  // Decorative poker chips are drawn into the exported artwork, with no external assets.
  for(const [x,y,r] of [[928,196,112],[102,1220,75]] as Array<[number,number,number]>) {
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle='#142923';ctx.fill();
    ctx.lineWidth=15;ctx.strokeStyle='#c3a060';ctx.stroke();
    ctx.beginPath();ctx.arc(x,y,r-24,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle='#8f784d';ctx.stroke();
    ctx.beginPath();ctx.arc(x,y,r-43,0,Math.PI*2);ctx.lineWidth=8;ctx.strokeStyle='#375448';ctx.stroke();
  }

  ctx.fillStyle='#d9b875';ctx.textAlign='left';ctx.font='600 36px Arial, sans-serif';
  ctx.fillText('♠  PKR  /  PRIVATE POKER',95,145);
  ctx.fillStyle='#f8f3e6';ctx.font='700 76px Georgia, serif';ctx.fillText('Game Results',95,275);
  ctx.font='600 37px Arial, sans-serif';ctx.fillStyle='#d5e2d7';
  ctx.fillText(fit(ctx,details.room,750),96,350);
  ctx.font='29px Arial, sans-serif';ctx.fillStyle='#afc4b9';ctx.fillText(fit(ctx,details.date,720),96,404);
  ctx.strokeStyle='rgba(216,184,117,.38)';ctx.lineWidth=2;ctx.beginPath();
  ctx.moveTo(95,452);ctx.lineTo(980,452);ctx.stroke();

  const ordered=[...details.players].sort((a,b)=>(b.net??0)-(a.net??0));
  const top=ordered.slice(0,8);
  if(!top.length){
    ctx.fillStyle='#b8c8c0';ctx.font='35px Arial, sans-serif';
    ctx.fillText('No completed player results available',96,580);
  }
  top.forEach((p,i)=>{
    const y=515+i*81;
    ctx.fillStyle=i===0?'rgba(213,175,89,.17)':'rgba(255,255,255,.045)';
    ctx.fillRect(95,y,885,68);
    ctx.fillStyle=i===0?'#d8b771':'#a9c6b4';
    ctx.font='700 33px Arial, sans-serif';ctx.fillText(String(i+1).padStart(2,'0'),115,y+46);
    ctx.fillStyle='#f0f2ea';ctx.font='600 34px Arial, sans-serif';
    ctx.fillText(fit(ctx,p.display_name,details.includeAmounts?500:730),198,y+46);
    if(details.includeAmounts&&Number.isSafeInteger(p.net)){
      ctx.fillStyle=(p.net??0)>0?'#70d9a0':(p.net??0)<0?'#ff9086':'#b2c5ba';
      ctx.font='700 29px Arial, sans-serif';ctx.textAlign='right';
      ctx.fillText(((p.net??0)>0?'+':'')+amt(p.net??0),955,y+44);
      ctx.textAlign='left';
    }
  });
  if(ordered.length>8){
    ctx.fillStyle='#a4bdb0';ctx.font='28px Arial, sans-serif';
    ctx.fillText('+ '+(ordered.length-8)+' more players',96,1210);
  }
  ctx.strokeStyle='rgba(218,177,99,.25)';ctx.beginPath();ctx.moveTo(95,1230);ctx.lineTo(980,1230);ctx.stroke();
  ctx.fillStyle='#b1baae';ctx.font='24px Arial, sans-serif';ctx.textAlign='center';
  ctx.fillText('PKR · Host-shared group results · No payment instructions',540,1270);

  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Could not create the results image.');
  return blob;
}
