import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from './auth';

const origin = 'https://pkr-reloaded-worker-staging.example.workers.dev';
const front = 'https://staging-example.vercel.app';
const env = {
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-value',
  FRONTEND_URL: front,
} as any;

afterEach(() => vi.unstubAllGlobals());

async function begin() {
  const res = await auth.request(origin + '/google', {}, env);
  const location = res.headers.get('location') || '';
  const cookie = res.headers.get('set-cookie') || '';
  const state = new URL(location).searchParams.get('state') || '';
  expect(res.status).toBe(302);
  expect(state).toBeTruthy();
  expect(cookie).toContain('__Host-pkr_oauth_state=' + state);
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  return { state, cookie: '__Host-pkr_oauth_state=' + state };
}

describe('Google OAuth browser state validation', () => {
  it('creates unique secure state cookies', async () => {
    const a = await begin();
    const b = await begin();
    expect(a.state).not.toBe(b.state);
  });

  it('rejects mismatched callback state before contacting Google', async () => {
    const { cookie } = await begin();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const res = await auth.request(origin + '/callback?code=dummy&state=wrong', {
      headers: { Cookie: cookie },
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(front + '/?error=oauth_denied');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a callback lacking its original browser cookie', async () => {
    const { state } = await begin();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const res = await auth.request(origin + '/callback?code=dummy&state=' + state, {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(front + '/?error=oauth_denied');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('proceeds to Google token exchange only for a matching state', async () => {
    const { state, cookie } = await begin();
    const mockFetch = vi.fn(async () => new Response('', { status: 400 }));
    vi.stubGlobal('fetch', mockFetch);
    const res = await auth.request(origin + '/callback?code=dummy&state=' + state, {
      headers: { Cookie: cookie },
    }, env);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(front + '/?error=token_failed');
  });
});
