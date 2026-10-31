import { describe, it, expect } from 'vitest';
import worker from './index';
import type { Env } from './types';

const base = {
  FRONTEND_URL: 'https://mypkr.app',
  PKR_ENV: 'production',
  JWT_SECRET: 'never-expose-test-jwt',
  PKR_CONTACT_KEY: 'never-expose-test-contact-key',
  VAPID_PRIVATE_KEY: 'never-expose-test-vapid-key',
} as Env;

async function health(extra: Partial<Env> = {}) {
  return worker.fetch(new Request('https://synthetic.invalid/health'),
    { ...base, ...extra }, {} as ExecutionContext);
}

describe('non-secret release capability health reporting', () => {
  it('reports disabled features rather than inferring readiness from a 200', async () => {
    const response = await health();
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.features).toEqual({ settlement_v2: false, push_rooms_v2: false, phone_members_v1: false, native_push: false });
    expect(body.release).toBe('settlement-v2-github-20261028');
  });
  it('reports web and native flags only when explicitly enabled', async () => {
    const response = await health({ PKR_SETTLEMENT_V2: '1', PKR_PUSH_ROOMS_V2: '1', PKR_PHONE_MEMBERS_V1: '1', PKR_NATIVE_PUSH_ENABLED: '1' });
    const body = await response.json() as any;
    expect(body.features).toEqual({ settlement_v2: true, push_rooms_v2: true, phone_members_v1: true, native_push: true });
    expect(body.environment).toBe('production');
    expect(JSON.stringify(body)).not.toContain('never-expose');
  });
  it('does not treat disabled strings as enabled', async () => {
    const response = await health({ PKR_SETTLEMENT_V2: '0', PKR_PUSH_ROOMS_V2: 'false' });
    const body = await response.json() as any;
    expect(body.features.settlement_v2).toBe(false);
    expect(body.features.push_rooms_v2).toBe(false);
    expect(body.features.native_push).toBe(false);
  });
});
