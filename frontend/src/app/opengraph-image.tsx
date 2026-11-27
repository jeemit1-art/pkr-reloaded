/* PKR launch share image. The final build embeds the same real app screenshots
   used by the homepage. A first capture build can render the brand before those
   screenshots exist; it never fabricates an application screen. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const size={width:1200,height:630};
export const contentType='image/png';

async function screenshot(name:string){
  try{return 'data:image/png;base64,'+(await readFile(path.join(process.cwd(),'public','demo','launch-20261127',name))).toString('base64');}
  catch{return null;}
}
export default async function Image(){
  const [desktop,mobile]=await Promise.all([screenshot('desktop-home.png'),screenshot('mobile-home.png')]);
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',position:'relative',display:'flex',background:'#F4F6F8',color:'#14242C',fontFamily:'sans-serif',overflow:'hidden'}}>
      <div style={{position:'absolute',width:600,height:600,right:-100,top:-80,borderRadius:350,background:'#FFECE5',display:'flex'}}/>
      <div style={{position:'absolute',top:65,left:64,display:'flex',alignItems:'center',gap:14}}>
        <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#CB5038" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3C9 7 3 9.5 3 14a4.5 4.5 0 0 0 8 2.8L9 21h6l-2-4.2A4.5 4.5 0 0 0 21 14c0-4.5-6-7-9-11Z"/></svg>
        <div style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:40,fontWeight:800,letterSpacing:-2}}>PKR</div><div style={{fontSize:11,letterSpacing:2,color:'#576972',fontWeight:600}}>YOUR PRIVATE POKER CLUB</div></div>
      </div>
      <div style={{position:'absolute',left:64,top:220,display:'flex',flexDirection:'column'}}><div style={{fontSize:72,letterSpacing:-3.7,fontWeight:800}}>More poker.</div><div style={{fontSize:72,letterSpacing:-3.7,fontWeight:800,color:'#A33D28'}}>Less admin.</div><div style={{fontSize:21,lineHeight:1.5,color:'#576972',maxWidth:390,marginTop:24}}>Your people, your game and every result. All together.</div></div>
      {desktop&&<div style={{position:'absolute',left:540,top:153,width:610,display:'flex',flexDirection:'column',padding:5,border:'1px solid #CAD5DC',borderRadius:15,background:'#FFFFFF',boxShadow:'0 20px 40px #14242C20',overflow:'hidden'}}><div style={{display:'flex',padding:'10px 12px',fontSize:11,color:'#576972'}}>mypkr.app · Actual app with demo data</div><img src={desktop} width={600} height={375} style={{borderRadius:9}} alt="PKR Home dashboard"/></div>}
      {mobile&&<div style={{position:'absolute',left:994,top:308,width:156,display:'flex',padding:4,border:'2px solid #CCD6DB',borderRadius:18,background:'#FFFFFF',boxShadow:'0 12px 28px #14242C25',overflow:'hidden'}}><img src={mobile} width={144} height={292} style={{borderRadius:11}} alt="PKR mobile Home"/></div>}
      <div style={{position:'absolute',bottom:46,left:64,display:'flex',alignItems:'center',gap:18}}><div style={{background:'#F27457',color:'#14242C',padding:'11px 18px',fontSize:21,borderRadius:11,fontWeight:700}}>mypkr.app</div><div style={{fontSize:14,color:'#576972'}}>Phone · Tablet · Desktop</div></div>
    </div>,{...size}
  );
}
