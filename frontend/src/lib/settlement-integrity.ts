import type {GameDetail,GamePlayer} from '@/lib/api';

/**
 * Historical settlements are never corrected from estimated present-day club rates.
 * This diagnostic only compares persisted records, and explicitly separates missing
 * data from a difference computed with an unverified historical buy-in assumption.
 */
export type PlayerIntegrityIssue={
 key:string;
 displayName:string;
 seatNumber:number|null;
 category:'incomplete'|'saved-arithmetic'|'historical-basis'|'unknown-basis';
 explanation:string;
 buyIns:number|null;
 recordedBuyinCents:number|null;
 comparisonBuyinCents:number|null;
 buyinSource:'recorded'|'current-default-estimate'|'unavailable';
 cashoutCents:number|null;
 netCents:number|null;
 comparisonNetCents:number|null;
};

export type GameIntegritySummary={
 gameId:string;
 scheduledAt:number;
 playerRecords:number;
 missingPlayers:number;
 mismatchPlayers:number;
 historicalBasisDifferences:number;
 savedArithmeticDifferences:number;
 savedNetCents:number;
 calculatedVarianceCents:number|null;
 savedVarianceCents:number|null;
 inconsistentGameVariance:boolean;
 emptyPlayerRoster:boolean;
 nonZeroSavedNet:boolean;
 needsReview:boolean;
 playerIssues:PlayerIntegrityIssue[];
};

const cents=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);

function investedBasis(player:GamePlayer,defaultBuyin:unknown):{
 amount:number|null;
 source:PlayerIntegrityIssue['buyinSource'];
 recorded:number|null;
}{
 const saved=player.buy_in_total;
 if(cents(saved)&&saved>0)return {amount:saved,source:'recorded',recorded:saved};
 if(!cents(player.buy_ins)||player.buy_ins<0||!cents(defaultBuyin)||defaultBuyin<0)
  return {amount:null,source:'unavailable',recorded:cents(saved)?saved:null};
 const estimated=player.buy_ins*defaultBuyin;
 if(!cents(estimated))return {amount:null,source:'unavailable',recorded:cents(saved)?saved:null};
 return {amount:estimated,source:'current-default-estimate',recorded:cents(saved)?saved:null};
}

export function reviewSettledGame(game:GameDetail):GameIntegritySummary{
 if(game.status!=='settled'||!game.id||!Number.isSafeInteger(game.scheduled_at)||!Array.isArray(game.players))
  throw new Error('Cannot review an invalid or unsettled game');
 const savedVariance=cents(game.variance)?game.variance:null;
 let missing=0,mismatches=0,historical=0,recorded=0,savedNet=0,calculated=0,complete=true;
 const playerIssues:PlayerIntegrityIssue[]=[];

 game.players.forEach((player,index)=>{
  const basis=investedBasis(player,game.buy_in);
  const cashout=cents(player.cashout)&&player.cashout>=0?player.cashout:null;
  const net=cents(player.net)?player.net:null;
  const comparisonNet=basis.amount!==null&&cashout!==null&&cents(cashout-basis.amount)
   ?cashout-basis.amount:null;
  const key=typeof player.user_id==='string'&&player.user_id?player.user_id:String(index);
  const name=typeof player.display_name==='string'&&player.display_name.trim()
   ?player.display_name.trim():cents(player.seat_number)&&player.seat_number>0
     ?'Seat '+player.seat_number:'Unlabelled player';
  const base={
   key,displayName:name,
   seatNumber:cents(player.seat_number)?player.seat_number:null,
   buyIns:cents(player.buy_ins)?player.buy_ins:null,
   recordedBuyinCents:basis.recorded,
   comparisonBuyinCents:basis.amount,
   buyinSource:basis.source,
   cashoutCents:cashout,
   netCents:net,
   comparisonNetCents:comparisonNet,
  };
  if(net!==null)savedNet+=net;
  else complete=false;
  if(net===null||cashout===null||comparisonNet===null){
   missing++;complete=false;
   const absent=net===null&&cashout===null?'Cash-out and net result are missing.':
    net===null?'Net result is missing.':cashout===null?'Cash-out is missing.':
    'Historical buy-in amount cannot be determined.';
   playerIssues.push({...base,
    category:comparisonNet===null&&net!==null&&cashout!==null?'unknown-basis':'incomplete',
    explanation:absent+' Confirm the original game evidence before recording a result.',
   });
   return;
  }
  calculated+=comparisonNet;
  if(net!==comparisonNet){
   mismatches++;
   if(basis.source==='recorded')recorded++;else historical++;
   playerIssues.push({...base,
    category:basis.source==='recorded'?'saved-arithmetic':'historical-basis',
    explanation:basis.source==='recorded'
     ?'Saved net differs from cash-out less the saved buy-in total. Review the original settlement.'
     :'Saved net differs from an estimate using today\'s club buy-in. The historical buy-in was not saved; this is not proof that the saved net is wrong.',
   });
  }
 });
 const emptyPlayerRoster=game.players.length===0;
 if(emptyPlayerRoster)complete=false;
 const calculatedVariance=complete&&cents(calculated)?calculated:null;
 const inconsistentGameVariance=calculatedVariance!==null&&savedVariance!==null
  &&calculatedVariance!==savedVariance;
 const nonZeroSavedNet=cents(savedNet)&&savedNet!==0;
 return {
  gameId:game.id,scheduledAt:game.scheduled_at,playerRecords:game.players.length,
  missingPlayers:missing,mismatchPlayers:mismatches,
  historicalBasisDifferences:historical,savedArithmeticDifferences:recorded,
  savedNetCents:savedNet,calculatedVarianceCents:calculatedVariance,
  savedVarianceCents:savedVariance,inconsistentGameVariance,
  emptyPlayerRoster,nonZeroSavedNet,
  playerIssues,
  needsReview:emptyPlayerRoster||missing>0||mismatches>0||nonZeroSavedNet||inconsistentGameVariance,
 };
}
export function summariseGameIntegrity(games:GameIntegritySummary[]){
 return {
  checked:games.length,
  flagged:games.filter(game=>game.needsReview).length,
  incomplete:games.reduce((sum,game)=>sum+game.missingPlayers,0),
  differences:games.reduce((sum,game)=>sum+game.mismatchPlayers,0),
  historical:games.reduce((sum,game)=>sum+game.historicalBasisDifferences,0),
  recorded:games.reduce((sum,game)=>sum+game.savedArithmeticDifferences,0),
  nonZero:games.filter(game=>game.nonZeroSavedNet).length,
 };
}
