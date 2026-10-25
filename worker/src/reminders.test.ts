import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('./push',()=>({sendPushToPlayer:vi.fn()}));
import {sendPushToPlayer} from './push';
import {sendPaymentReminders} from './reminders';

const send=vi.mocked(sendPushToPlayer);
function fixture(){
  const writes:Array<{sql:string;args:unknown[]}>= [];
  const row={id:'t1',amount:2500,from_name:'Synthetic Payer',to_name:'Synthetic Receiver',
    game_id:'g1',event_id:'room-1',results_token:'synthetic-result',event_name:'Test Room'};
  const env:any={DB:{prepare(sql:string){return {bind(...args:unknown[]){return {
    all:async()=>({results:[row]}),
    run:async()=>{writes.push({sql,args});return {meta:{changes:1}};},
  };}};}}};
  return {env,writes};
}
beforeEach(()=>send.mockReset());

describe('daily payment reminder accounting',()=>{
  it('does not record a reminder when no push subscription is accepted',async()=>{
    send.mockResolvedValue(0);
    const f=fixture();await sendPaymentReminders(f.env);
    expect(send).toHaveBeenCalledOnce();
    expect(f.writes).toHaveLength(0);
    const body=send.mock.calls[0][3].body;
    expect(body).toContain('host or co-host');
    expect(body).not.toContain("I've paid");
  });
  it('records a reminder when a push service accepted one message',async()=>{
    send.mockResolvedValue(1);
    const f=fixture();await sendPaymentReminders(f.env);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].sql).toContain('last_reminded_at');
    expect(f.writes[0].args[1]).toBe('t1');
  });
});