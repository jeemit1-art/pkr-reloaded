import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',()=>({
  authMiddleware:async(c:any,next:any)=>{c.set('userId',c.env.TEST_USER||'payer');await next()},
  requireEventRole:async(c:any,_event:string,role:string)=>{
    const identity=c.get('userId');
    const rank=c.env.TEST_MEMBERS?.[identity]||0;
    return rank>=(role==='host'?3:role==='cohost'?2:1);
  },
}));
vi.mock('../push',()=>({sendPushToAccount:vi.fn(async()=>1)}));
import payments from './payments';

type Item={id:string;game_id:string;from_user:string;to_user:string;from_name:string;to_name:string;
  amount:number;status:string;paid_at:number|null;last_reminded_at:number|null;created_at:number};
function fixture(){
  const rows:Item[]=[
    {id:'t1',game_id:'g1',from_user:'payer',to_user:'receiver',from_name:'Payer',to_name:'Receiver',
      amount:7500,status:'owed',paid_at:null,last_reminded_at:null,created_at:100},
    {id:'t2',game_id:'g1',from_user:'other',to_user:'receiver',from_name:'Other',to_name:'Receiver',
      amount:7523500,status:'legacy',paid_at:null,last_reminded_at:null,created_at:100},
  ];
  const audit:any[]=[];const settings:any={game_id:'g1',enabled:0,reminders_enabled:0,last_broadcast_at:null};
  let gameStatus='settled';
  const env:any={PKR_SETTLEMENT_V2:'1',PKR_ENV:'staging',TEST_USER:'payer',
    TEST_MEMBERS:{payer:1,receiver:1,host:3,outsider:0},DB:{
      prepare(sql:string){return{bind(...args:any[]){return{
        async first(){
          if(sql.includes('SELECT id,event_id,status,results_token FROM games'))return{id:'g1',event_id:'e1',status:gameStatus,results_token:'token'};
          if(sql.includes('SELECT * FROM settlement_transfers WHERE id=?'))return rows.find(x=>x.id===args[0]&&x.game_id===args[1])||null;
          if(sql.includes('SELECT last_broadcast_at,reminders_enabled FROM settlement_notification_settings'))return settings;
          if(sql.includes('SELECT * FROM settlement_notification_settings'))return settings.enabled?settings:null;
          if(sql.includes('SELECT enabled FROM settlement_notification_settings'))return settings;
          if(sql.includes('COUNT(*) AS count FROM settlement_transfers'))return {count:rows.filter(x=>x.status==='owed'||x.status==='not_received'||x.status==='payer_claimed').length};
          return null;
        },
        async all(){
          if(sql.includes('SELECT id,status,amount FROM settlement_transfers')){
            return{results:rows.filter(x=>x.game_id===args[0]&&args.slice(1).includes(x.id))};
          }
          if(sql.includes('FROM settlement_transfers WHERE game_id=? AND status IN')){
            return{results:rows.filter(x=>x.game_id===args[0]&&['owed','not_received','payer_claimed'].includes(x.status))};
          }
          return{results:[]};
        },
        async run(){
          if(sql.startsWith('UPDATE settlement_transfers SET status=')){
            let item:Item|undefined;
            if(sql.includes('WHERE game_id=? AND id=?')&&args.length===5)
              item=rows.find(x=>x.id===args[3]&&x.game_id===args[2]&&x.status===args[4]);
            else if(sql.includes('WHERE id=? AND game_id=?')&&args.length===6)
              item=rows.find(x=>x.id===args[3]&&x.game_id===args[4]&&x.status===args[5]);
            if(!item)return{meta:{changes:0}};
            item.status=args[0];item.paid_at=args[1];item.last_reminded_at=args[2];
            return{meta:{changes:1}};
          }
          if(sql.startsWith('INSERT INTO settlement_confirmation_events')){audit.push(args);return{meta:{changes:1}};}
          if(sql.startsWith('INSERT INTO settlement_notification_settings')){
            settings.enabled=1;settings.reminders_enabled=args[1];settings.last_broadcast_at=args[2];return{meta:{changes:1}};
          }
          if(sql.startsWith('UPDATE settlement_notification_settings')){
            settings.reminders_enabled=args[0];return{meta:{changes:1}};
          }
          return{meta:{changes:1}};
        },
      }}}},
      async batch(statements:any[]){const r=[];for(const st of statements)r.push(await st.run());return r},
    }};
  const call=(path:string,user:string,body?:any,method='POST')=>{
    env.TEST_USER=user;
    return payments.request('https://test.invalid'+path,
      {method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
  };
  return{rows,audit,env,settings,call,setGameStatus:(value:string)=>{gameStatus=value}};
}
describe('opt-in settlement V2 identity and money protection',()=>{
  it('fails closed unless additive schema feature flag is activated',async()=>{
    const f=fixture();f.env.PKR_SETTLEMENT_V2=undefined;
    const res=await f.call('/games/g1/transfers/t1/respond','payer',{action:'sent'});
    expect(res.status).toBe(503);expect(f.rows[0].status).toBe('owed');
  });
  it('only the verified payer can mark their own transfer as sent',async()=>{
    const f=fixture();
    const nope=await f.call('/games/g1/transfers/t1/respond','receiver',{action:'sent'});
    expect(nope.status).toBe(403);expect(f.rows[0].status).toBe('owed');
    const ok=await f.call('/games/g1/transfers/t1/respond','payer',{action:'sent'});
    expect(ok.status).toBe(200);expect(f.rows[0].status).toBe('payer_claimed');
    expect(f.rows[0].paid_at).toBeNull();
    expect(f.audit.some(a=>a[4]==='sent')).toBe(true);
  });
  it('recipient must confirm receipt, and can dispute a claimed payment',async()=>{
    const f=fixture();
    await f.call('/games/g1/transfers/t1/respond','payer',{action:'sent'});
    const denied=await f.call('/games/g1/transfers/t1/respond','payer',{action:'received'});
    expect(denied.status).toBe(403);
    const received=await f.call('/games/g1/transfers/t1/respond','receiver',{action:'received'});
    expect(received.status).toBe(200);expect(f.rows[0].status).toBe('paid');
    expect(f.rows[0].paid_at).toBeGreaterThan(0);
  });
  it('allows recipient dispute without incorrectly marking a transfer as paid',async()=>{
    const f=fixture();await f.call('/games/g1/transfers/t1/respond','payer',{action:'sent'});
    const r=await f.call('/games/g1/transfers/t1/respond','receiver',{action:'not_received'});
    expect(r.status).toBe(200);expect(f.rows[0].status).toBe('not_received');expect(f.rows[0].paid_at).toBeNull();
  });
  it('prevents all historical $75,235 payments from accidental bulk updates',async()=>{
    const f=fixture();
    const bad=await f.call('/games/g1/transfers/bulk-status','host',{ids:['t1','t2'],status:'paid'});
    expect(bad.status).toBe(409);expect(f.rows.map(r=>r.status)).toEqual(['owed','legacy']);
    const good=await f.call('/games/g1/transfers/bulk-status','host',{ids:['t1'],status:'paid'});
    expect(good.status).toBe(200);expect(f.rows[0].status).toBe('paid');
    expect(f.rows[1].status).toBe('legacy');
  });

  it('sends per-person settlement requests only after host broadcast, with opt-in reminders',async()=>{
    const f=fixture();
    const res=await f.call('/games/g1/settlement-control/broadcast','host',{reminders_enabled:true});
    expect(res.status).toBe(200);
    const payload=await res.json() as {transfers:number;push_accepted:number;reminders_enabled:boolean};
    expect(payload.transfers).toBe(1); // the unverified historical transfer is excluded
    expect(payload.push_accepted).toBe(2); // one notification each to payer and recipient
    expect(payload.reminders_enabled).toBe(true);
    expect(f.settings.enabled).toBe(1);
    const duplicate=await f.call('/games/g1/settlement-control/broadcast','host',{reminders_enabled:true});
    expect(duplicate.status).toBe(429);
    const pause=await f.call('/games/g1/settlement-control/reminders','host',{enabled:false},'PUT');
    expect(pause.status).toBe(200);expect(f.settings.reminders_enabled).toBe(0);
  });
  it('does not allow a non-manager to initiate settlement notifications',async()=>{
    const f=fixture();
    const denied=await f.call('/games/g1/settlement-control/broadcast','payer',{reminders_enabled:true});
    expect(denied.status).toBe(403);expect(f.settings.enabled).toBe(0);
    f.setGameStatus('active');
    const premature=await f.call('/games/g1/settlement-control/broadcast','host',{reminders_enabled:true});
    expect(premature.status).toBe(409);expect(f.settings.enabled).toBe(0);
  });
});
