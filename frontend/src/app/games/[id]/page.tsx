"use client";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function GameBridgePage() {
  const params = useParams();
  const router = useRouter();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  useEffect(() => {
    // Redirect directly to native play page — no more table.html bridge
    router.replace(`/games/${id}/play`);
  }, [id]);

  return (
    <div style={{
      position:'fixed', inset:0, background:'#060e07',
      display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:16
    }}>
      <div style={{color:'#c9a84c', fontFamily:'serif', fontSize:48, opacity:0.6}}>♠</div>
      <div style={{color:'#6b8c6e', fontFamily:'sans-serif', fontSize:14, letterSpacing:2}}>LOADING</div>
    </div>
  );
}
