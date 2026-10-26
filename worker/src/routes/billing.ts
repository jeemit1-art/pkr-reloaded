// worker/src/routes/billing.ts
// Handles Stripe subscription checkout, webhooks, and customer portal
import { Hono } from 'hono';
import { Env, User } from '../types';
import { authMiddleware } from '../middleware';
import {HOST_PRICES,isConfiguredAudPrice,verifiedPaidSubscription,type PaidPlan} from '../billing-entitlement';

const billing = new Hono<{ Bindings: Env }>();

// ── Plan config ───────────────────────────────────────────────────────────────
// Create these Price IDs in your Stripe Dashboard first:
//   Starter: $9.99/month recurring → copy price_xxxx ID
//   Pro:     $19.99/month recurring → copy price_xxxx ID
// Then set as wrangler secrets:
//   npx wrangler secret put STRIPE_PRICE_STARTER
//   npx wrangler secret put STRIPE_PRICE_PRO
const PLANS = {
  starter: { label: 'Starter', price_aud_cents: 999,  features: ['1 group', 'Up to 9 seats', 'Buy-ins, live view, leaderboard, hand tracking'] },
  pro:     { label: 'Pro',     price_aud_cents: 1999, features: ['Unlimited groups', 'Up to 15 seats', 'AI analysis', 'Tournament mode', 'Player stats', 'Rabbit hunt'] },
};

// ── Helper: call Stripe REST API directly (no SDK needed in Workers) ──────────
async function stripe(
  env: Env,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, string>
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

// ── GET /billing/plan — current plan status for logged-in user ────────────────
billing.get('/plan', authMiddleware, async (c) => {
  const user = await c.env.DB.prepare(
    'SELECT id, email, name, plan, trial_started_at, plan_expires_at, stripe_customer_id, stripe_subscription_id FROM users WHERE id=?'
  ).bind(c.get('userId')).first<User>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const now = Math.floor(Date.now() / 1000);

  // Initialise trial_started_at on first call if not set
  if (!user.trial_started_at) {
    await c.env.DB.prepare('UPDATE users SET trial_started_at=? WHERE id=?').bind(now, user.id).run();
    user.trial_started_at = now;
  }

  const TRIAL_DAYS = 5;
  const trialEnd = user.trial_started_at + TRIAL_DAYS * 86400;
  const trialActive = false; // No complimentary hosting access.
  const trialDaysLeft = 0;

  // Check if a paid plan has expired
  let effectivePlan = user.plan;
  if ((user.plan === 'starter' || user.plan === 'pro') && user.plan_expires_at && user.plan_expires_at < now) {
    effectivePlan = 'trial';
    await c.env.DB.prepare('UPDATE users SET plan=? WHERE id=?').bind('trial', user.id).run();
  }

  const paid=(effectivePlan==='starter'||effectivePlan==='pro')&&
    !!user.stripe_subscription_id?.startsWith('sub_')&&
    Number.isSafeInteger(user.plan_expires_at)&&Number(user.plan_expires_at)>now;
  const isActive=effectivePlan==='lifetime'||paid;

  return c.json({
    plan: effectivePlan,
    trial_active: trialActive,
    trial_days_left: trialDaysLeft,
    trial_end: trialEnd,
    plan_expires_at: user.plan_expires_at,
    is_active: isActive,
    has_payment: !!user.stripe_customer_id&&!!user.stripe_subscription_id,
    // What this plan allows:
    max_groups: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? null : 1,
    max_seats: effectivePlan === 'pro' || effectivePlan === 'lifetime' ? 15 : 9,
  });
});

// ── POST /billing/checkout — create Stripe Checkout session ──────────────────
billing.post('/checkout', authMiddleware, async (c) => {
  const input=await c.req.json().catch(()=>null) as {plan?:PaidPlan}|null;
  const plan=input?.plan;
  if (!plan || !PLANS[plan]) return c.json({ error: 'Invalid plan' }, 400);

  // Production Wrangler does not require PKR_ENV to be explicitly set.
  // All environments except the isolated staging Worker must use live Stripe.
  if(c.env.PKR_ENV!=='staging' && !c.env.STRIPE_SECRET_KEY?.startsWith('sk_live_'))
    return c.json({error:'Live Stripe billing is not configured. Contact support.'},503);
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, email, name, stripe_customer_id, stripe_subscription_id, plan_expires_at FROM users WHERE id=?')
    .bind(userId).first<User>();
  if (!user) return c.json({ error: 'Not found' }, 404);
  if(user.stripe_subscription_id&&Number(user.plan_expires_at)>Math.floor(Date.now()/1000))
    return c.json({error:'An active subscription already exists. Use Manage Subscription to change plans.',
      code:'ALREADY_SUBSCRIBED'},409);

  const priceId = plan === 'starter'
    ? (c.env as any).STRIPE_PRICE_STARTER
    : (c.env as any).STRIPE_PRICE_PRO;

  if (!priceId) return c.json({ error: 'Subscription pricing is not configured. Contact support.' }, 503);
  // A misleading USD or trial price must never be sold under the AUD banner.
  const configured=await stripe(c.env,'/prices/'+encodeURIComponent(priceId));
  if(!isConfiguredAudPrice(configured,plan) || (c.env.PKR_ENV!=='staging'&&configured.livemode!==true))
    return c.json({error:'Subscription pricing is not configured for AUD monthly billing. Contact support.'},503);

  const front = c.env.FRONTEND_URL;

  // Get or create Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe(c.env, '/customers', 'POST', {
      email: user.email,
      name: user.name,
      'metadata[pkr_user_id]': user.id,
    });
    customerId = customer.id as string;
    await c.env.DB.prepare('UPDATE users SET stripe_customer_id=? WHERE id=?').bind(customerId, user.id).run();
  }

  // Create checkout session
  const session = await stripe(c.env, '/checkout/sessions', 'POST', {
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'subscription',
    success_url: `${front}/dashboard?upgraded=1`,
    cancel_url: `${front}/dashboard?upgrade_cancelled=1`,
    'subscription_data[metadata][pkr_user_id]': user.id,
    'subscription_data[metadata][plan]': plan,
    'metadata[pkr_user_id]': user.id,
    'metadata[plan]': plan,
    'payment_method_types[0]': 'card',
  });

  return c.json({ url: session.url });
});

// ── POST /billing/portal — Stripe customer portal for manage/cancel ───────────
billing.post('/portal', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id=?')
    .bind(userId).first<User>();
  if (!user?.stripe_customer_id) return c.json({ error: 'No subscription found' }, 404);

  const front = c.env.FRONTEND_URL;
  const session = await stripe(c.env, '/billing_portal/sessions', 'POST', {
    customer: user.stripe_customer_id,
    return_url: `${front}/dashboard`,
  });
  return c.json({ url: session.url });
});

// ── POST /billing/webhook — Stripe sends events here ─────────────────────────
// Set this URL in Stripe Dashboard → Webhooks → Add endpoint:
//   https://pkr-reloaded-worker.jeemit1.workers.dev/billing/webhook
// Events to listen for: checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted, invoice.payment_failed
billing.post('/webhook', async (c) => {
  const body = await c.req.text();
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'No signature' }, 400);

  // Verify webhook signature using Stripe's algorithm
  const valid = await verifyStripeSignature(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return c.json({ error: 'Invalid signature' }, 400);

  let event:{id?:string;type:string;data:{object:any}};
  try{event=JSON.parse(body);}catch{return c.json({error:'Invalid webhook payload'},400);}
  const now=Math.floor(Date.now()/1000);
  const priceIds:Record<PaidPlan,string|undefined>={
    starter:(c.env as any).STRIPE_PRICE_STARTER,pro:(c.env as any).STRIPE_PRICE_PRO,
  };

  async function refreshSubscription(userId:string,subId:string,allowNew=false,customerFromCheckout?:string){
    const user=await c.env.DB.prepare(
      'SELECT stripe_customer_id,stripe_subscription_id FROM users WHERE id=?'
    ).bind(userId).first<{stripe_customer_id:string|null;stripe_subscription_id:string|null}>();
    if(!user?.stripe_customer_id)return;
    if(customerFromCheckout&&customerFromCheckout!==user.stripe_customer_id)return;
    if(!allowNew&&user.stripe_subscription_id!==subId)return;
    const actual=await stripe(c.env,'/subscriptions/'+encodeURIComponent(subId)+'?expand%5B%5D=latest_invoice');
    // Stripe's current record is authoritative; delayed/replayed webhook bodies
    // cannot reactivate a canceled or unpaid subscription.
    if(c.env.PKR_ENV!=='staging'&&actual.livemode!==true)
      throw new Error('Production billing requires a live Stripe subscription');
    const entitlement=verifiedPaidSubscription(
      actual,userId,user.stripe_customer_id,priceIds,now
    );
    if(entitlement){
      if(allowNew&&user.stripe_subscription_id&&user.stripe_subscription_id!==subId){
        // A delayed Checkout event cannot replace a newer paid subscription.
        const previous=await stripe(c.env,'/subscriptions/'+encodeURIComponent(user.stripe_subscription_id));
        if(Number(previous.created)>=Number(actual.created))return;
      }
      await c.env.DB.prepare(
        'UPDATE users SET plan=?,plan_expires_at=?,stripe_subscription_id=? WHERE id=?'
      ).bind(entitlement.plan,entitlement.periodEnd,subId,userId).run();
    }else if(!allowNew&&user.stripe_subscription_id===subId){
      await c.env.DB.prepare(
        "UPDATE users SET plan='trial',plan_expires_at=? WHERE id=? AND stripe_subscription_id=?"
      ).bind(now-1,userId,subId).run();
    }
  }

  switch(event.type){
    case 'checkout.session.completed':{
      const session=event.data.object;
      if(session.mode!=='subscription'||session.payment_status!=='paid')break;
      const userId=session.metadata?.pkr_user_id;
      const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
      const customer=typeof session.customer==='string'?session.customer:session.customer?.id;
      if(userId&&subId&&customer)
        await refreshSubscription(userId,subId,true,customer);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created':{
      const sub=event.data.object;
      if(sub.metadata?.pkr_user_id&&sub.id)
        await refreshSubscription(sub.metadata.pkr_user_id,sub.id);
      break;
    }
    case 'customer.subscription.deleted':{
      const sub=event.data.object;
      if(sub.metadata?.pkr_user_id&&sub.id)
        await c.env.DB.prepare(
          "UPDATE users SET plan='trial',stripe_subscription_id=NULL,plan_expires_at=NULL WHERE id=? AND stripe_subscription_id=?"
        ).bind(sub.metadata.pkr_user_id,sub.id).run();
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed':{
      const invoice=event.data.object;
      const subId=invoice.subscription||invoice.parent?.subscription_details?.subscription;
      const id=typeof subId==='string'?subId:subId?.id;
      if(id){
        const current=await c.env.DB.prepare(
          'SELECT id FROM users WHERE stripe_subscription_id=?'
        ).bind(id).first<{id:string}>();
        if(current)await refreshSubscription(current.id,id);
      }
      break;
    }
  }

  return c.json({ ok: true });
});

// ── Stripe webhook signature verification ─────────────────────────────────────
/**
 * Validate the raw Stripe webhook body, with Stripe's 300-second freshness
 * tolerance and cryptographic HMAC verification (instead of a string equality
 * comparison). Accept multiple v1 signatures to support secret rotation.
 *
 * This only authenticates a delivery. Persistent event-ID deduplication and
 * subscription-state ordering require a separate transactional work item.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    if (!secret || !header) return false;
    let timestampString = '';
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name === 't') timestampString = value;
      if (name === 'v1') signatures.push(value);
    }
    if (!/^\d{1,12}$/.test(timestampString) || signatures.length === 0) return false;
    const timestamp = Number(timestampString);
    const nowSeconds = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 ||
        !Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - timestamp) > 300) {
      return false;
    }

    const signed = new TextEncoder().encode(timestampString + '.' + payload);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    for (const signature of signatures) {
      if (!/^[0-9a-f]{64}$/i.test(signature)) continue;
      const bytes = Uint8Array.from(signature.match(/.{2}/g)!, x => Number.parseInt(x, 16));
      if (await crypto.subtle.verify('HMAC', key, bytes, signed)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default billing;
