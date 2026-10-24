import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Test the actual hand-tracker picker shipped to browsers.
const source=readFileSync(
  new URL('../../frontend/public/hand-tracker.js',import.meta.url),'utf8'
);
const start=source.indexOf('window.htPickCard = function(card){');
const end=source.indexOf('window.htAssignPotWinner',start);
if(start<0||end<=start)throw Error('Shipped card picker not found');
const picker=source.slice(start,end);
async function settle(){
  await new Promise(resolve=>setTimeout(resolve,0));
}
function fixture(send:(url:string,opts:any)=>Promise<any>){
  const messages:string[]=[];
  let renders=0,closed=0;
  const hs:any={
    hand:{id:'h'},board:[],cardTarget:0,_autoCardMode:null,
    view:'cards',holes:{},_boardSaving:false,
  };
  const sandbox:any={
    window:{closeCardPicker:()=>{closed++;}},
    hs,
    htApi:send,
    getGameId:()=> 'g',
    renderBoardOnFelt:()=>{renders++;},
    renderBody:()=>{renders++;},
    toast:(message:string)=>{messages.push(message);},
    loadCurrentHand:async()=>{
      // In real app this refreshes the server authoritative board.
      hs.board=['K♠'];
    },
  };
  runInNewContext(picker,sandbox);
  return {hs,messages,sandbox,renders:()=>renders,closed:()=>closed};
}
describe('shipped board picker concurrency recovery',()=>{
  it('sends the last observed cards and only updates UI after confirmation',async()=>{
    const requests:Array<{url:string;body:any}>=[];
    let finish:(value:any)=>void=()=>{};
    const f=fixture((url,opts)=>new Promise(resolve=>{
      finish=resolve;requests.push({url,body:JSON.parse(opts.body)});
    }));
    f.sandbox.window.htPickCard('A♠');
    expect(requests).toEqual([{
      url:'/games/g/hands/h/board',
      body:{board:['A♠'],expected_board:[]},
    }]);
    expect(Array.from(f.hs.board)).toEqual([]);
    f.sandbox.window.htPickCard('Q♠');
    expect(requests).toHaveLength(1);
    expect(f.messages.at(-1)).toMatch(/still saving/);
    finish({ok:true,board:['A♠']});
    await settle();
    expect(Array.from(f.hs.board)).toEqual(['A♠']);
    expect(f.hs._boardSaving).toBe(false);
    expect(f.closed()).toBe(1);
  });
  it('reloads another host’s board after a rejected stale write',async()=>{
    const f=fixture(async()=>{throw new Error('BOARD_CONFLICT')});
    f.sandbox.window.htPickCard('A♠');
    await settle();
    expect(Array.from(f.hs.board)).toEqual(['K♠']);
    expect(f.hs._boardSaving).toBe(false);
    expect(f.messages.some(m=>m.includes('not saved'))).toBe(true);
    expect(f.closed()).toBe(1);
  });
  it('does not auto-advance the flop before its preceding card is saved',async()=>{
    let finish:(value:any)=>void=()=>{};
    const f=fixture(async()=>new Promise(resolve=>{finish=resolve;}));
    f.hs._autoCardMode='flop';
    f.sandbox.window.htPickCard('A♠');
    expect(f.hs.cardTarget).toBe(0);
    finish({ok:true,board:['A♠']});
    await settle();
    expect(f.hs.cardTarget).toBe(1);
    expect(f.hs._boardSaving).toBe(false);
  });
});
