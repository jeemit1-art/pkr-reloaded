import {api, type Game, type Transfer, type RoomLedgerData} from '@/lib/api';
import {isOutstanding} from '@/lib/record-details';

// Shared read-only settlement source for each room dashboard and the Insights
// settlement centre. Never infer debts from buy-ins, net results or leaderboards.
export type RoomTransferRecord = {game:Game;transfer:Transfer};
export type RoomTransferLoad = {
  records:RoomTransferRecord[];
  unavailable:Game[];
  settledGameCount:number;
  gamesWithoutTransfers:Game[];
  source:'room-ledger'|'game-details';
};
function check(signal?:AbortSignal){
  if(signal?.aborted)throw new DOMException('Payment load cancelled','AbortError');
}
const KNOWN_STATUSES=new Set(['owed','paid','payer_claimed','not_received','legacy']);
type StoredTransfer=Transfer&{game_id?:string;from_user?:string;to_user?:string};
function validTransfer(t:StoredTransfer):Transfer|null{
  if(!t||typeof t.id!=='string'||!t.id.trim()||
     !Number.isSafeInteger(t.amount)||t.amount<0||
     !KNOWN_STATUSES.has(String(t.status||'')))return null;
  // Older saved records can have NULL/empty display names even when their
  // immutable payer/recipient IDs, paid status and integer cents are valid.
  // Do not falsely mark the entire game unverified over missing *labels*.
  // These placeholders disclose missing names; they never invent identities.
  const from=typeof t.from==='string'&&t.from?t.from:t.from_user;
  const to=typeof t.to==='string'&&t.to?t.to:t.to_user;
  if(typeof from!=='string'||!from.trim()||typeof to!=='string'||!to.trim())return null;
  const from_name=typeof t.from_name==='string'&&t.from_name.trim()
    ?t.from_name.trim():'Payer name unavailable';
  const to_name=typeof t.to_name==='string'&&t.to_name.trim()
    ?t.to_name.trim():'Recipient name unavailable';
  return {...t,from,to,from_name,to_name};
}
function fromRoomLedger(roomId:string,saved:RoomLedgerData,expected?:Game[]):RoomTransferLoad{
  if(!saved||!Array.isArray(saved.games)||!Array.isArray(saved.transfers))
    throw new Error('Invalid room settlement ledger response');
  const games=new Map<string,Game>();
  for(const game of saved.games){
    if(!game||game.event_id!==roomId||game.status!=='settled'||typeof game.id!=='string'||!game.id||
       !Number.isSafeInteger(game.scheduled_at)||games.has(game.id))
      throw new Error('Invalid settled game in room ledger');
    games.set(game.id,game);
  }
  // A stale/partial snapshot must never silently drop an already-listed game.
  for(const game of expected||[]){
    if(game.event_id===roomId&&game.status==='settled'&&!games.has(game.id))
      throw new Error('Room ledger omitted a settled game');
  }
  const records:RoomTransferRecord[]=[];
  const counted=new Set<string>();
  for(const raw of saved.transfers){
    const game=games.get(raw?.game_id);
    const transfer=raw?validTransfer(raw):null;
    if(!game||!transfer)throw new Error('Room ledger contains incomplete transfer data');
    records.push({game,transfer});
    counted.add(game.id);
  }
  return {
    records,unavailable:[],settledGameCount:games.size,
    gamesWithoutTransfers:[...games.values()].filter(game=>!counted.has(game.id)),
    source:'room-ledger',
  };
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
  check(signal);
  // Prefer one authenticated, read-only D1 snapshot. This bypasses older
  // per-game result/RSVP dependencies and uses the saved settlement ledger.
  // Fall back while existing production Workers are being upgraded.
  try{
    const ledger=await api.events.settlementLedger(roomId);
    check(signal);
    return fromRoomLedger(roomId,ledger,games);
  }catch(error){
    check(signal);
    // This path is read-only. It does not change or invent a paid status.
  }
  const all=games||await api.games.list(roomId);
  check(signal);
  const settled=all.filter(game=>game.event_id===roomId&&game.status==='settled');
  const records:RoomTransferRecord[]=[];
  const unavailable:Game[]=[];
  const gamesWithoutTransfers:Game[]=[];
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
      if(!Array.isArray(transfers)){unavailable.push(game);continue;}
      const verified=transfers.map(raw=>validTransfer(raw));
      if(verified.some(item=>item===null)){
        unavailable.push(game);
        continue;
      }
      if(!verified.length)gamesWithoutTransfers.push(game);
      for(const transfer of verified)records.push({game,transfer:transfer!});
    }
  }
  return {records,unavailable,settledGameCount:settled.length,
    gamesWithoutTransfers,source:'game-details'};
}

export function outstandingRoomTransfers(records:RoomTransferRecord[]){
  return records.filter(row=>isOutstanding(row.transfer))
    .sort((a,b)=>b.game.scheduled_at-a.game.scheduled_at||
      String(a.transfer.id||'').localeCompare(String(b.transfer.id||'')));
}
export function totalTransferCents(rows:RoomTransferRecord[]){
  return rows.reduce((sum,row)=>sum+row.transfer.amount,0);
}
