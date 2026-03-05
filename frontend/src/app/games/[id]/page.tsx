"use client";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { api, getToken } from "@/lib/api";

export default function GameBridgePage() {
  const params = useParams();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  useEffect(() => {
    async function bridge() {
      try {
        const [game, me] = await Promise.all([api.games.get(id), api.auth.me()]);

        let isHost = false;
        const eventId = (game as any).event_id;
        try {
          const ev = await api.events.get(eventId);
          const member = (ev.members || []).find((m: any) => m.id === me.id);
          isHost = member?.role === "host" || member?.role === "cohost";
        } catch {}

        const buyInDollars = ((game as any).buy_in || 0) / 100;

        // ── Check if we already have live state for this exact game ──
        // If so, skip re-initialising localStorage so in-progress chips are preserved
        let skipStateInit = false;
        try {
          const existingCtx = JSON.parse(localStorage.getItem("pkrCtx") || "null");
          const existingState = JSON.parse(localStorage.getItem("pokerState") || "null");
          if (existingCtx?.gameId === id && existingState?.game && !existingState.game.ended) {
            skipStateInit = true;
          }
        } catch {}

        if (!skipStateInit) {
          const players: Record<string, any> = {};
          ((game as any).players || []).forEach((p: any, i: number) => {
            const sid = "seat" + (p.seat_number || (i + 1));
            const count = p.buy_ins || 1;
            const transactions: any[] = [];
            for (let b = 0; b < count; b++) {
              transactions.push({ type: "buyin", amount: buyInDollars, ts: Date.now() - (count - b) * 60000 });
            }
            if (p.cashout != null) transactions.push({ type: "cashout", amount: p.cashout / 100, ts: Date.now() });
            players[sid] = { name: p.display_name, userId: p.user_id, phone: p.whatsapp || "", transactions };
            if (p.whatsapp) {
              try {
                const phones = JSON.parse(localStorage.getItem("pokerPhones") || "{}");
                phones[p.display_name.toLowerCase()] = { name: p.display_name, phone: p.whatsapp };
                localStorage.setItem("pokerPhones", JSON.stringify(phones));
              } catch {}
            }
          });

          const state = {
            game: {
              name: (game as any).event_name || "Poker Night",
              stakes: "",
              seats: (game as any).seats || 9,
              startedAt: Date.now(),
              gameDate: new Date((game as any).scheduled_at * 1000).toISOString(),
              location: (game as any).location || "",
              code: (game as any).live_token || "LOCAL",
              defaultBuyin: buyInDollars,
              password: (game as any).game_password || null,
              lobbyActive: false, // PKR lobby page handles pre-game RSVPs
            },
            players,
          };

          // Scope keys to eventId+userId to match table.html scoping
          const lsScope = eventId + '_' + me.id;
          localStorage.setItem("pokerState_" + lsScope, JSON.stringify(state));
          // Clear old unscoped keys so they can't be read by table.html fallback
          localStorage.removeItem("pokerState");
          localStorage.removeItem("pokerStats");
          localStorage.removeItem("pokerHistory");
          localStorage.removeItem("pokerPhones");
          localStorage.setItem("cloudRole", isHost ? "host" : "player");
          localStorage.setItem("cloudGameCode", (game as any).live_token || "LOCAL");
          localStorage.setItem("cloudMyName", me.name || (isHost ? "Host" : "Player"));
        }

        // Always refresh pkrCtx with latest token
        localStorage.setItem("pkrCtx", JSON.stringify({
          gameId: id,
          eventId: eventId,
          apiUrl: process.env.NEXT_PUBLIC_API_URL || "",
          token: getToken(),
          userId: me.id,
          userName: me.name,
          // Stable settle key — does NOT include Date.now() so retries are safe
          settleKey: id + "_end",
        }));

        // Always open the game screen — PKR lobby page handles pre-game RSVPs
        window.location.href = "/table.html#game";
      } catch (err) {
        console.error("Bridge error:", err);
        const fallbackCtx = (() => { try { return JSON.parse(localStorage.getItem("pkrCtx") || "null"); } catch { return null; } })();
        window.location.href = fallbackCtx?.eventId ? `/events/${fallbackCtx.eventId}` : "/dashboard";
      }
    }
    bridge();
  }, [id]);

  return (
    <div style={{position:"fixed",inset:0,background:"#060e07",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{color:"#c9a84c",fontFamily:"Playfair Display,serif",fontSize:48,opacity:0.6}}>&#9824;</div>
      <div style={{color:"#6b8c6e",fontFamily:"DM Sans,sans-serif",fontSize:14,letterSpacing:2}}>LOADING</div>
    </div>
  );
}