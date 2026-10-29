import {api, type Game, type Transfer} from '@/lib/api';
import {isOutstanding} from '@/lib/record-details';

// Shared read-only settlement source for each room dashboard and the Insights
// settlement centre. Never infer debts from buy-ins, net results or leaderboards.
export type RoomTransferRecord = {game:Game;transfer:Transfer};
export type RoomTransferLoad = {
  records:RoomTransferRecord[];
  unavailable:Game[];
  settledGameCount:number;
};
function check(signal?:AbortSignal){
  if(signal?.aborted)throw new DOMException('Payment load cancelled','AbortError');
}
async function gameTransfers(game:Game):Promise<Transfer[]>{
  if(game.results_token){
    try{
      const result=await api.games.results(game.results_token);
      if(result.game?.id===game.id&&Array.isArray(result.transfers))
        return result.transfers;
    }catch{/* Existing authenticated saved game is the fallback. */}
  }
  const saved=await api.games.get(game.id);
  if(saved.id!==game.id||saved.status!=='settled'||!Array.isArray(saved.transfers))
    throw new Error('Saved settlement is not available');
  return saved.transfers;
}
export async function loadRoomTransfers(roomId:string,games?:Game[],signal?:AbortSignal):Promise<RoomTransferLoad>{
  const all=games||await api.games.list(roomId);
  check(signal);
  const settled=all.filter(game=>game.event_id===roomId&&game.status==='settled');
  const records:RoomTransferRecord[]=[];
  const unavailable:Game[]=[];
  // Bounded concurrency: no full-room fan-out across 100+ old games.
  for(let offset=0;offset<settled.length;offset+=4){
    check(signal);
    const group=settled.slice(offset,offset+4);
    const batch=await Promise.allSettled(group.map(async game=>({game,transfers:await gameTransfers(game)})));
    check(signal);
    for(let i=0;i<batch.length;i++){
      const result=batch[i];
      if(result.status==='rejected'){unavailable.push(group[i]);continue;}
      const {game,transfers}=result.value;
      if(transfers.some(t=>!Number.isSafeInteger(t.amount)||t.amount<0||
        typeof t.from_name!=='string'||typeof t.to_name!=='string')){
        unavailable.push(game);
        continue;
      }
      for(const transfer of transfers)records.push({game,transfer});
    }
  }
  return {records,unavailable,settledGameCount:settled.length};
}
export function outstandingRoomTransfers(records:RoomTransferRecord[]){
  return records.filter(row=>isOutstanding(row.transfer))
    .sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at||
      String(a.transfer.id||'').localeCompare(String(b.transfer.id||'')));
}
export function totalTransferCents(rows:RoomTransferRecord[]){
  return rows.reduce((sum,row)=>sum+row.transfer.amount,0);
}
