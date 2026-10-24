import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from './billing';

const secret = 'whsec_test_only_not_a_real_payment_secret';
const now = Date.UTC(2026, 9, 24, 10, 30, 0); // fixed UTC timestamp: deterministic

async function signedHeader(payload: string, timestamp: number, key = secret) {
  const hmac = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), {name:'HMAC',hash:'SHA-256'}, false, ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC', hmac, new TextEncoder().encode(timestamp + '.' + payload),
  );
  const v1 = Array.from(new Uint8Array(mac)).map(n=>n.toString(16).padStart(2,'0')).join('');
  return 't=' + timestamp + ',v1=' + v1;
}

describe('Stripe webhook delivery signature verification', () => {
  const payload = JSON.stringify({id:'evt_synthetic_test_only',type:'customer.subscription.updated'});
  const timestamp = Math.floor(now / 1000);

  it('accepts a valid signed current delivery', async () => {
    expect(await verifyStripeSignature(payload, await signedHeader(payload,timestamp),secret,now)).toBe(true);
  });

  it('rejects signed deliveries outside the five-minute replay window', async () => {
    expect(await verifyStripeSignature(payload,await signedHeader(payload,timestamp-301),secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,await signedHeader(payload,timestamp+301),secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,await signedHeader(payload,timestamp-300),secret,now)).toBe(true);
    expect(await verifyStripeSignature(payload,await signedHeader(payload,timestamp+300),secret,now)).toBe(true);
  });

  it('rejects changed payloads, invalid keys, missing headers and unknown signature schemes', async () => {
    const header = await signedHeader(payload,timestamp);
    expect(await verifyStripeSignature(payload+' ',header,secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,header,'wrong-test-secret',now)).toBe(false);
    expect(await verifyStripeSignature(payload,'',secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,header,'',now)).toBe(false);
    expect(await verifyStripeSignature(payload,header.replace('v1=','v0='),secret,now)).toBe(false);
  });

  it('accepts any valid v1 signature when Stripe rotates webhook secrets', async () => {
    const valid = await signedHeader(payload,timestamp);
    const header = valid.replace(',v1=', ',v1='+'0'.repeat(64)+',v1=');
    expect(await verifyStripeSignature(payload,header,secret,now)).toBe(true);
  });

  it('rejects fake timestamps and malformed signature values', async () => {
    const header = await signedHeader(payload,timestamp);
    expect(await verifyStripeSignature(payload,header.replace('t='+timestamp,'t=invalid'),secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,header.replace('v1=', 'v1=xyz'),secret,now)).toBe(false);
    expect(await verifyStripeSignature(payload,header.replace('t='+timestamp,'t=0'),secret,now)).toBe(false);
  });
});
