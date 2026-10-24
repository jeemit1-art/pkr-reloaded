import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from './auth';

const origin = 'https://pkr-reloaded-worker-staging.example.workers.dev';
const front = 'https://staging-example.vercel.app';
const env = {
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-value',
  FRONTEND_URL: front,
} as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    expect(res.headers.get('location')).toBe(front + '/?error=token_failed&reason=unknown');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns a safe reason when Google rejects staging OAuth credentials', async () => {
    const { state, cookie } = await begin();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_client',
      error_description: 'Sensitive details are not included in redirects or logs',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', mockFetch);
    const res = await auth.request(origin + '/callback?code=dummy&state=' + state, {
      headers: { Cookie: cookie },
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(front + '/?error=token_failed&reason=invalid_client');
    expect(warn).toHaveBeenCalledWith('Google OAuth token exchange rejected', {
      status: 401,
      reason: 'invalid_client',
    });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('does not send an OAuth request if the staging client secret is missing', async () => {
    const { state, cookie } = await begin();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const res = await auth.request(origin + '/callback?code=dummy&state=' + state, {
      headers: { Cookie: cookie },
    }, { ...env, GOOGLE_CLIENT_SECRET: undefined });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(front + '/?error=token_failed&reason=missing_client_secret');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not reflect unexpected Google errors or response details to the browser', async () => {
    const { state, cookie } = await begin();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'internal_debug_123',
      error_description: 'Secret or private Google response',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    const res = await auth.request(origin + '/callback?code=dummy&state=' + state, {
      headers: { Cookie: cookie },
    }, env);
    expect(res.headers.get('location')).toBe(front + '/?error=token_failed&reason=unknown');
  });
});
