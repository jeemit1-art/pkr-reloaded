import {describe,it,expect} from 'vitest';
import {HOST_PRICES,isConfiguredAudPrice,verifiedPaidSubscription} from './billing-entitlement';

const prices={starter:'price_synthetic_starter',pro:'price_synthetic_pro'};
const now=1800000000;
function sub(){
 return {id:'sub_synthetic',status:'active',customer:'cus_synthetic',
   metadata:{pkr_user_id:'synthetic-host'},
   items:{data:[{current_period_end:now+86400,quantity:1,
     price:{id:prices.starter,currency:'aud',unit_amount:HOST_PRICES.starter,
       recurring:{interval:'month'}}}]},
   latest_invoice:{id:'in_synthetic',status:'paid',amount_paid:999}};
}
const verify=(s:any)=>verifiedPaidSubscription(s,'synthetic-host','cus_synthetic',prices,now);
describe('paid host entitlements',()=>{
 it('accepts the current fully verified paid AUD subscription',()=>{
   expect(verify(sub())).toEqual({plan:'starter',periodEnd:now+86400});
 });
 it('rejects trials, failed payment, wrong customer and wrong user',()=>{
   const a=sub();a.status='trialing';expect(verify(a)).toBeNull();
   const b=sub();b.latest_invoice.status='open';expect(verify(b)).toBeNull();
   const c=sub();c.latest_invoice.amount_paid=0;expect(verify(c)).toBeNull();
   const d=sub();d.customer='cus_other';expect(verify(d)).toBeNull();
   const e=sub();e.metadata.pkr_user_id='other';expect(verify(e)).toBeNull();
 });
 it('rejects free, wrong-currency, unknown, multi-item and expired subscriptions',()=>{
   const a=sub();a.items.data[0].price.currency='usd';expect(verify(a)).toBeNull();
   const b=sub();b.items.data[0].price.id='price_other';expect(verify(b)).toBeNull();
   const c=sub();c.items.data[0].current_period_end=now-1;expect(verify(c)).toBeNull();
   const d=sub();d.items.data.push({...d.items.data[0]});expect(verify(d)).toBeNull();
 });
 it('validates advertised recurring AUD checkout prices before creating a session',()=>{
   const p={id:prices.pro,active:true,currency:'aud',unit_amount:1999,type:'recurring',
      recurring:{interval:'month',trial_period_days:null}};
   expect(isConfiguredAudPrice(p,'pro')).toBe(true);
   expect(isConfiguredAudPrice({...p,currency:'usd'},'pro')).toBe(false);
   expect(isConfiguredAudPrice({...p,unit_amount:0},'pro')).toBe(false);
   expect(isConfiguredAudPrice({...p,recurring:{interval:'month',trial_period_days:5}},'pro')).toBe(false);
 });
});
