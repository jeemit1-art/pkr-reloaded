/**
 * Stripe-paid host entitlement. Never infer payment from a chosen plan,
 * a Stripe customer ID, or the existence of a Checkout Session.
 */
export type PaidPlan='starter'|'pro';
export const HOST_PRICES:Record<PaidPlan,number>={starter:999,pro:1999};

export function verifiedPaidSubscription(
  subscription:any,
  userId:string,
  customerId:string,
  priceIds:Record<PaidPlan,string|undefined>,
  now:number=Math.floor(Date.now()/1000),
):{plan:PaidPlan;periodEnd:number}|null{
  if(!subscription||subscription.status!=='active'||
     subscription.metadata?.pkr_user_id!==userId)return null;
  const customer=typeof subscription.customer==='string'
    ?subscription.customer:subscription.customer?.id;
  if(!customerId||customer!==customerId)return null;
  const items=subscription.items?.data;
  if(!Array.isArray(items)||items.length!==1)return null;
  const item=items[0],price=item?.price;
  const plan=(['starter','pro'] as PaidPlan[]).find(p=>priceIds[p]&&priceIds[p]===price?.id);
  if(!plan||price?.currency!=='aud'||price?.unit_amount!==HOST_PRICES[plan]||
     price?.recurring?.interval!=='month'||Number(item.quantity)!==1)return null;
  const invoice=subscription.latest_invoice;
  // Requires the expanded invoice, confirming a real successful payment.
  if(!invoice||typeof invoice!=='object'||invoice.status!=='paid'||
     !Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<=0)return null;
  const periodEnd=Number(item.current_period_end??subscription.current_period_end);
  if(!Number.isSafeInteger(periodEnd)||periodEnd<=now)return null;
  return {plan,periodEnd};
}

export function isConfiguredAudPrice(price:any,plan:PaidPlan):boolean{
  return !!price&&price.active===true&&price.currency==='aud'&&
    price.unit_amount===HOST_PRICES[plan]&&
    price.type==='recurring'&&price.recurring?.interval==='month'&&
    price.recurring?.trial_period_days==null;
}
