import {describe,it,expect} from 'vitest';
import {normalizeMobile,encryptPhone,decryptPhone,phoneLookup,maskMobile,phoneMembersReady} from './phone-security';
const env:any={PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:'staging-fake-test-key-more-than-32-bytes'};
describe('private mobile identities',()=>{
  it('accepts AU mobile numbers and international E.164, rejects Australian landlines',()=>{
    expect(normalizeMobile('0412 345 678')).toBe('+61412345678');
    expect(normalizeMobile('61412345678')).toBe('+61412345678');
    expect(normalizeMobile('+61 412 345 678')).toBe('+61412345678');
    expect(normalizeMobile('+14155552671')).toBe('+14155552671');
    expect(normalizeMobile('07 3123 4567')).toBeNull();
    expect(normalizeMobile('+61731234567')).toBeNull();
    expect(normalizeMobile('test')).toBeNull();
  });
  it('encrypts phone at rest with fresh nonce and scopes blind index by group',async()=>{
    const mobile='+61412345678';
    const a=await encryptPhone(env,mobile);
    const b=await encryptPhone(env,mobile);
    expect(a).not.toBe(b);
    expect(a).not.toContain(mobile);
    expect(await decryptPhone(env,a)).toBe(mobile);
    expect(await phoneLookup(env,'group:A',mobile)).not.toBe(await phoneLookup(env,'group:B',mobile));
    expect(maskMobile(mobile)).toBe('•••• 5678');
  });
  it('stays disabled without dedicated key and flag',()=>{
    expect(phoneMembersReady({PKR_PHONE_MEMBERS_V1:'1'} as any)).toBe(false);
    expect(phoneMembersReady({PKR_CONTACT_KEY:env.PKR_CONTACT_KEY} as any)).toBe(false);
    expect(phoneMembersReady(env)).toBe(true);
  });
});
