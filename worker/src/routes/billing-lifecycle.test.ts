import {afterEach,describe,expect,it,vi} from 'vitest';
import billing from './billing';

const now=()=>Math.floor(Date.now()/1000);
const secret='whsec_synthetic_local_test_only';
const prices={starter:'price_synthetic_starter',pro:'price_synthetic_pro'};

async function signature(payload:string){
  const timestamp=now();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(timestamp+'.'+payload));
  return 't='+timestamp+',v1='+Array.from(new Uint8Array(bytes))
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
function fixture(){
  const user:{plan:string;stripe_customer_id:string;stripe_subscription_id:string|null;plan_expires_at:number|null}={
    plan:'trial',stripe_customer_id:'cus_synthetic',stripe_subscription_id:null,plan_expires_at:null};
  const sub:any={
    id:'sub_synthetic',created:now()-60,livemode:true,status:'active',
    customer:'cus_synthetic',metadata:{pkr_user_id:'synthetic-host',plan:'starter'},
    items:{data:[{current_period_end:now()+86400,quantity:1,
      price:{id:prices.starter,currency:'aud',unit_amount:999,recurring:{interval:'month'}}}]},
    latest_invoice:{id:'in_synthetic',status:'paid',amount_paid:999},
  };
  const DB={
    prepare(sql:string){return {bind(...values:any[]){return {
      async first(){
        if(sql.includes('SELECT stripe_customer_id,stripe_subscription_id FROM users WHERE id=?'))
          return values[0]==='synthetic-host'?{...user}:null;
        if(sql.includes('SELECT id FROM users WHERE stripe_subscription_id=?'))
          return values[0]===user.stripe_subscription_id?{id:'synthetic-host'}:null;
        return null;
      },
      async run(){
        if(sql.startsWith('UPDATE users SET plan=?,plan_expires_at=?,stripe_subscription_id=?')){
          user.plan=values[0];user.plan_expires_at=values[1];user.stripe_subscription_id=values[2];
        }else if(sql.includes("UPDATE users SET plan='trial',plan_expires_at=?")){
          if(user.stripe_subscription_id===values[2]){
            user.plan='trial';user.plan_expires_at=values[0];
          }
        }else if(sql.includes("UPDATE users SET plan='trial',stripe_subscription_id=NULL")){
          if(user.stripe_subscription_id===values[1]){
            user.plan='trial';user.stripe_subscription_id=null;user.plan_expires_at=null;
          }
        }else throw Error('Unexpected synthetic SQL: '+sql);
        return {meta:{changes:1}};
      },
    }};}},
  };
  const env:any={DB,PKR_ENV:'production',STRIPE_WEBHOOK_SECRET:secret,
    STRIPE_SECRET_KEY:'sk_live_synthetic_test_only',STRIPE_PRICE_STARTER:prices.starter,
    STRIPE_PRICE_PRO:prices.pro};
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
    const url=String(input);
    if(url.includes('/v1/subscriptions/'))
      return new Response(JSON.stringify(sub),{status:200,headers:{'Content-Type':'application/json'}});
    throw Error('Unexpected external request: '+url);
  }));
  async function send(type:string,object:any,overrideSignature?:string){
    const payload=JSON.stringify({id:'evt_synthetic',type,data:{object}});
    return billing.request('https://isolated.invalid/webhook',{
      method:'POST',headers:{'Content-Type':'application/json',
        'stripe-signature':overrideSignature??await signature(payload)},body:payload,
    },env);
  }
  return {user,sub,send};
}
afterEach(()=>vi.unstubAllGlobals());

describe('paid Stripe webhook lifecycle with only synthetic events',()=>{
  it('activates a paid Checkout subscription and stores a finite paid-through date',async()=>{
    const f=fixture();
    const response=await f.send('checkout.session.completed',{
      mode:'subscription',payment_status:'paid',customer:'cus_synthetic',
      subscription:'sub_synthetic',metadata:{pkr_user_id:'synthetic-host',plan:'starter'},
    });
    expect(response.status).toBe(200);
    expect(f.user.plan).toBe('starter');
    expect(f.user.stripe_subscription_id).toBe('sub_synthetic');
    expect(f.user.plan_expires_at).toBeGreaterThan(now());
  });
  it('never unlocks a subscription with no confirmed paid invoice',async()=>{
    const f=fixture();f.sub.latest_invoice.status='open';
    const response=await f.send('checkout.session.completed',{
      mode:'subscription',payment_status:'paid',customer:'cus_synthetic',
      subscription:'sub_synthetic',metadata:{pkr_user_id:'synthetic-host'},
    });
    expect(response.status).toBe(200);
    expect(f.user.plan).toBe('trial');
    expect(f.user.stripe_subscription_id).toBeNull();
  });
  it('renews access on invoice.paid and revokes it after a failed renewal',async()=>{
    const f=fixture();f.user.stripe_subscription_id='sub_synthetic';
    const paid=await f.send('invoice.paid',{subscription:'sub_synthetic'});
    expect(paid.status).toBe(200);expect(f.user.plan).toBe('starter');
    f.sub.status='past_due';
    const failed=await f.send('invoice.payment_failed',{subscription:'sub_synthetic'});
    expect(failed.status).toBe(200);expect(f.user.plan).toBe('trial');
  });
  it('ignores cancellation of an unrelated old subscription and revokes the current one',async()=>{
    const f=fixture();f.user.plan='starter';f.user.stripe_subscription_id='sub_synthetic';
    const old=await f.send('customer.subscription.deleted',{
      id:'sub_older',metadata:{pkr_user_id:'synthetic-host'}});
    expect(old.status).toBe(200);expect(f.user.plan).toBe('starter');
    const current=await f.send('customer.subscription.deleted',{
      id:'sub_synthetic',metadata:{pkr_user_id:'synthetic-host'}});
    expect(current.status).toBe(200);expect(f.user.plan).toBe('trial');
    expect(f.user.stripe_subscription_id).toBeNull();
  });
  it('rejects invalid webhook signatures without changing the account',async()=>{
    const f=fixture();
    const result=await f.send('invoice.paid',{subscription:'sub_synthetic'},'t=1,v1='+'0'.repeat(64));
    expect(result.status).toBe(400);
    expect(f.user.plan).toBe('trial');
  });
});
