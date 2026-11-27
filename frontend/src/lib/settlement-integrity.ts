import type {GameDetail,GamePlayer} from '@/lib/api';

/**
 * Read-only diagnostic for saved, settled game records.
 * No fixes, guessed payments, or settled-status changes. Use the same legacy
 * buy-in fallback as prepareSettlementPositions() on the Worker.
 */
export type GameIntegritySummary={
 gameId:string;
 scheduledAt:number;
 playerRecords:number;
 missingPlayers:number;
 mismatchPlayers:number;
 savedNetCents:number;
 calculatedVarianceCents:number|null;
 savedVarianceCents:number|null;
 inconsistentGameVariance:boolean;
 emptyPlayerRoster:boolean;
 nonZeroSavedNet:boolean;
 needsReview:boolean;
};

const cents=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);
const safeBuyin=(player:GamePlayer,defaultBuyin:unknown):number|null=>{
 const explicit=(player as GamePlayer & {buy_in_total?:number|null}).buy_in_total;
 if(cents(explicit)&&explicit>0)return explicit;
 if(!cents(player.buy_ins)||player.buy_ins<0||!cents(defaultBuyin)||defaultBuyin<0)return null;
 const inferred=player.buy_ins*defaultBuyin;
 return cents(inferred)?inferred:null;
};

export function reviewSettledGame(game:GameDetail):GameIntegritySummary{
 if(game.status!=='settled'||!game.id||!Number.isSafeInteger(game.scheduled_at)||!Array.isArray(game.players))
  throw new Error('Cannot review an invalid or unsettled game');
 const savedVariance=cents(game.variance)?game.variance:null;
 const defaultBuyin=game.buy_in;
 let missing=0,mismatches=0,savedNet=0,calculated=0,complete=true;
 for(const player of game.players){
  const invested=safeBuyin(player,defaultBuyin);
  if(!cents(player.net)||!cents(player.cashout)||player.cashout<0||invested===null){
   missing++;complete=false;
  }else{
   const expectedNet=player.cashout-invested;
   if(!cents(expectedNet)){missing++;complete=false;}
   else{
    calculated+=expectedNet;
    if(player.net!==expectedNet)mismatches++;
   }
  }
  if(cents(player.net))savedNet+=player.net;
  else complete=false;
 }
 const rosterEmpty=game.players.length===0;
 if(rosterEmpty)complete=false;
 const calculatedVariance=complete&&cents(calculated)?calculated:null;
 const inconsistent=calculatedVariance!==null&&savedVariance!==null
  &&calculatedVariance!==savedVariance;
 const nonZeroSavedNet=cents(savedNet)&&savedNet!==0;
 return {
  gameId:game.id,
  scheduledAt:game.scheduled_at,
  playerRecords:game.players.length,
  missingPlayers:missing,
  mismatchPlayers:mismatches,
  savedNetCents:savedNet,
  calculatedVarianceCents:calculatedVariance,
  savedVarianceCents:savedVariance,
  inconsistentGameVariance:inconsistent,
  emptyPlayerRoster:rosterEmpty,
  nonZeroSavedNet,
  needsReview:rosterEmpty||missing>0||mismatches>0||nonZeroSavedNet||inconsistent,
 };
}

export function summariseGameIntegrity(games:GameIntegritySummary[]){
 return {
  checked:games.length,
  flagged:games.filter(game=>game.needsReview).length,
  incomplete:games.reduce((sum,game)=>sum+game.missingPlayers,0),
  differences:games.reduce((sum,game)=>sum+game.mismatchPlayers,0),
  nonZero:games.filter(game=>game.nonZeroSavedNet).length,
 };
}
