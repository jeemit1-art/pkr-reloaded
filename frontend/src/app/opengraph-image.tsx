/* Theme A Midnight Felt social share image. Design-only artwork, no data access.
   Replaces the old gold share image via the static Next Open Graph route.
   Always 1200x630 PNG and retains the site's existing main promise. */
import { ImageResponse } from 'next/og';

export const size={width:1200,height:630};
export const contentType='image/png';

export default function Image(){
  const dark='#0B0F12',surface='#131A1F',line='#26323A',ink='#EAF0F2',muted='#8A99A3',lime='#3DDC97',gold='#F2B84B',felt='#0F5C4A';
  return new ImageResponse(
    <div style={{
      width:'100%',height:'100%',position:'relative',display:'flex',
      background:dark,color:ink,fontFamily:'sans-serif',overflow:'hidden'
    }}>
      <div style={{display:'flex',position:'absolute',right:-100,top:55,width:590,height:590,
        alignItems:'center',justifyContent:'center',borderRadius:360,
        background:'radial-gradient(circle, #143D32 0%, #0B0F12 78%)'}}>
        <div style={{width:510,height:325,display:'flex',alignItems:'center',justifyContent:'center',
          borderRadius:200,transform:'rotate(-15deg)',background:'#28333A',
          border:'12px solid #465762'}}>
          <div style={{width:450,height:267,display:'flex',alignItems:'center',justifyContent:'center',
            borderRadius:200,background:felt,border:'3px solid #3E9273',
            boxShadow:'inset 0 0 0 10px #0D503F'}}>
            <div style={{fontSize:140,color:ink,transform:'rotate(15deg)'}}>♠</div>
          </div>
        </div>
      </div>
      <div style={{position:'absolute',top:70,left:72,display:'flex',alignItems:'center',gap:18}}>
        <div style={{width:66,height:66,borderRadius:15,background:lime,color:dark,display:'flex',
          alignItems:'center',justifyContent:'center',fontSize:53,fontWeight:700}}>♠</div>
        <div style={{display:'flex',flexDirection:'column',justifyContent:'center'}}>
          <div style={{fontSize:45,fontWeight:900,letterSpacing:-2}}>PKR</div>
          <div style={{fontSize:13,fontWeight:700,letterSpacing:2.5,color:muted}}>PRIVATE POKER CLUB</div>
        </div>
      </div>
      <div style={{position:'absolute',top:245,left:72,display:'flex',flexDirection:'column',gap:0}}>
        <div style={{fontSize:77,letterSpacing:-3.8,fontWeight:800,color:ink}}>More poker.</div>
        <div style={{fontSize:77,letterSpacing:-3.8,fontWeight:800,color:gold}}>Less admin.</div>
      </div>
      <div style={{position:'absolute',bottom:89,left:72,width:380,height:2,background:line,display:'flex'}}/>
      <div style={{position:'absolute',bottom:47,left:72,fontSize:23,color:lime,fontWeight:700,display:'flex'}}>mypkr.app</div>
      <div style={{position:'absolute',bottom:46,right:58,fontSize:14,color:muted,display:'flex'}}>PRIVATE POKER GAME MANAGEMENT</div>
    </div>,
    {...size}
  );
}
