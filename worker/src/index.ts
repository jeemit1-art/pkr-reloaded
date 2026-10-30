// worker/src/index.ts
import { Hono } from 'hono';
import { Env } from './types';
import { corsHeaders } from './middleware';
import auth    from './routes/auth';
import events  from './routes/events';
import memberProfiles from './routes/member-profiles';
import historicalVisibility from './routes/historical-visibility';
import games   from './routes/games';
import rsvpBoard from './routes/rsvp-board';
import phoneMembers from './routes/phone-members';
import billing from './routes/billing';
import hands      from './routes/hands';
import tournament from './routes/tournament';
import analysis   from './routes/analysis';
import payments   from './routes/payments';
import { sendPaymentReminders,sendGameReminders } from './reminders';
import { advanceExpiredTournamentLevels } from './tournament-clock';

const app = new Hono<{ Bindings: Env }>();

// CORS for every request
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const headers = corsHeaders(origin, c.env.FRONTEND_URL, c.env.PKR_ENV === 'staging');
  if (c.req.method === 'OPTIONS') return new Response(null, { status:204, headers });
  await next();
  Object.entries(headers).forEach(([k,v]) => c.res.headers.set(k,v));
});

app.route('/auth',    auth);
app.route('/events',  memberProfiles);
app.route('/events',  historicalVisibility);
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
app.route('/',        phoneMembers);
app.route('/',        rsvpBoard);
app.route('/',        games);
app.route('/',        tournament);
app.route('/',        analysis);

// Only public capability booleans: never credentials or player information.
// These report configuration, not proof of end-to-end device delivery.
app.get('/health', (c) => c.json({
  ok:true, service:'pkr-reloaded-worker',
  environment:c.env.PKR_ENV === 'staging' ? 'staging' : 'production',
  release:'settlement-v2-github-20261028',
  features:{
    settlement_v2:c.env.PKR_SETTLEMENT_V2==='1',
    push_rooms_v2:c.env.PKR_PUSH_ROOMS_V2==='1',
    phone_members_v1:c.env.PKR_PHONE_MEMBERS_V1==='1',
  },
  ts:Date.now(),
}));
app.get('/vapid-public-key',(c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));
app.notFound(               (c) => c.json({ error:'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if(env.PKR_ENV==='staging')return;
    // Split the frequencies: hourly reminders must not run every minute.
    if(event.cron==='* * * * *'){
      ctx.waitUntil(advanceExpiredTournamentLevels(env.DB).then((r)=>{
        if(r.advanced||r.conflicts)console.log('PKR tournament clock',r);
      }));
      return;
    }
    if(event.cron==='0 * * * *'){
      ctx.waitUntil(Promise.allSettled([
        sendPaymentReminders(env),sendGameReminders(env),
      ]).then(()=>{}));
    }
  },
};
