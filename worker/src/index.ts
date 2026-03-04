import { Hono } from 'hono';
import { Env } from './types';
import { corsHeaders } from './middleware';
import auth   from './routes/auth';
import events from './routes/events';
import games  from './routes/games';

const app = new Hono<{ Bindings: Env }>();

// CORS for every request — pass runtime FRONTEND_URL from env bindings
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  const headers = corsHeaders(origin, c.env.FRONTEND_URL);
  if (c.req.method === 'OPTIONS') return new Response(null, { status:204, headers });
  await next();
  Object.entries(headers).forEach(([k,v]) => c.res.headers.set(k,v));
});

app.route('/auth',   auth);
app.route('/events', events);
app.route('/',       games);

app.get('/health',         (c) => c.json({ ok:true, service:'pkr-reloaded-worker', ts:Date.now() }));
app.get('/vapid-public-key',(c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));
app.notFound(              (c) => c.json({ error:'Not found' }, 404));

export default app;
