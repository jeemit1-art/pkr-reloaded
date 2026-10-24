// worker/src/index.ts — FULL REPLACEMENT
import { Hono } from 'hono';
import { Env } from './types';
import { corsHeaders } from './middleware';
import auth    from './routes/auth';
import events  from './routes/events';
import games   from './routes/games';
import billing from './routes/billing';
import hands      from './routes/hands';
import tournament from './routes/tournament';
import analysis   from './routes/analysis';
import payments   from './routes/payments';
import { sendPaymentReminders } from './reminders';

const app = new Hono<{ Bindings: Env }>();

// CORS for every request
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const headers = corsHeaders(origin, c.env.FRONTEND_URL);
  if (c.req.method === 'OPTIONS') return new Response(null, { status:204, headers });
  await next();
  Object.entries(headers).forEach(([k,v]) => c.res.headers.set(k,v));
});

app.route('/auth',    auth);
app.route('/events',  events);
// Staging cannot initiate payments, expose a billing portal, or accept webhooks.
app.use('/billing/*', async (c, next) => {
  if (c.env.PKR_ENV === 'staging' && c.req.path !== '/billing/plan') {
    return c.json({ error: 'Payments are disabled in PKR staging' }, 403);
  }
  await next();
});
app.use('/games/:id/analysis/*', async (c, next) => {
  if (c.env.PKR_ENV === 'staging' && c.req.method === 'POST') {
    return c.json({ error: 'Paid AI analysis is disabled in staging' }, 403);
  }
  await next();
});
app.route('/billing', billing);
app.route('/',        hands);
app.route('/',        payments);
app.route('/',        games);
app.route('/',        tournament);
app.route('/',        analysis);

app.get('/health',          (c) => c.json({ ok:true, service:'pkr-reloaded-worker', environment:c.env.PKR_ENV === 'staging' ? 'staging' : 'production', ts:Date.now() }));
app.get('/vapid-public-key',(c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));
app.notFound(               (c) => c.json({ error:'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.PKR_ENV === 'staging') return;
    ctx.waitUntil(sendPaymentReminders(env));
  },
};
