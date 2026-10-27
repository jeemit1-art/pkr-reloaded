import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('./push',()=>({sendPushToAccount:vi.fn()}));
import {sendPushToAccount} from './push';
import {sendPaymentReminders} from './reminders';

const send=vi.mocked(sendPushToAccount);
function fixture(){
  const writes:Array<{sql:string;args:unknown[]}>= [];
  const row={id:'t1',amount:2500,from_user:'verified-member-1',from_name:'Synthetic Payer',to_name:'Synthetic Receiver',
    game_id:'g1',event_id:'room-1',results_token:'synthetic-result',event_name:'Test Room'};
  const env:any={PKR_ENV:'production',PKR_SETTLEMENT_V2:'1',DB:{prepare(sql:string){return {bind(...args:unknown[]){return {
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
    expect(body).toContain('Once paid');
    expect(send.mock.calls[0][2]).toBe('verified-member-1');
    expect(body).not.toContain("I've paid");
  });
  it('never sends by default without the settlement feature being enabled',async()=>{
    const f=fixture();f.env.PKR_SETTLEMENT_V2=undefined;
    await sendPaymentReminders(f.env);
    expect(send).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });
  it('records a reminder when a push service accepted one message',async()=>{
    send.mockResolvedValue(1);
    const f=fixture();await sendPaymentReminders(f.env);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].sql).toContain('last_reminded_at');
    expect(f.writes[0].args[1]).toBe('t1');
  });
});