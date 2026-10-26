import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('./push',()=>({
  sendPushToPlayer:vi.fn(),
  sendPushToEvent:vi.fn(),
}));
import {sendPushToEvent} from './push';
import {sendGameReminders} from './reminders';

const send=vi.mocked(sendPushToEvent);
function fixture(){
  const kv=new Map<string,string>();
  const sqls:string[]=[];
  const game={id:'g1',event_id:'room1',scheduled_at:Math.floor(Date.now()/1000)+24*3600+1200,
    location:'Test clubhouse',event_name:'Test Poker'};
  const env:any={
    PKR_ENV:'production',
    KV:{get:async(key:string)=>kv.get(key)||null,put:async(key:string,v:string)=>{kv.set(key,v)}},
    DB:{prepare:(sql:string)=>{
      sqls.push(sql);
      return {bind:(_a:number,_b:number)=>({
        all:async()=>({results:_a<=game.scheduled_at && _b>game.scheduled_at?[game]:[]})
      })};
    }}
  };
  return {env,kv,sqls};
}
beforeEach(()=>send.mockReset());

describe('hourly game reminders with opt-in push and de-duplication',()=>{
  it('does not send in staging',async()=>{
    await sendGameReminders({PKR_ENV:'staging'} as any);
    expect(send).not.toHaveBeenCalled();
  });
  it('sends one day-before reminder and records a successful service acceptance',async()=>{
    send.mockResolvedValue(1);
    const f=fixture();
    await sendGameReminders(f.env);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][2].data?.type).toBe('game_reminder');
    expect([...f.kv.keys()].some(k=>k.startsWith('game-reminder:g1:day:'))).toBe(true);
    await sendGameReminders(f.env);
    expect(send).toHaveBeenCalledOnce();
  });
  it('keeps the reminder eligible when no push service accepted delivery',async()=>{
    send.mockResolvedValue(0);
    const f=fixture();
    await sendGameReminders(f.env);
    expect(f.kv.size).toBe(0);
  });
});
