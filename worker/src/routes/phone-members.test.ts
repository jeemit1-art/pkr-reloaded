import {describe,it,expect} from 'vitest';
import phone from './phone-members';
const base='https://example.invalid';
describe('mobile-first membership locked until staging migration',()=>{
  it('does not touch the database when the feature is disabled',async()=>{
    const env:any={PKR_PHONE_MEMBERS_V1:'0'};
    const r=await phone.request(base+'/phone-invites/anytoken',{},env);
    expect(r.status).toBe(503);
    expect((await r.json() as any).code).toBe('PHONE_MEMBERS_NOT_READY');
  });
  it('denies unauthenticated group contact enumeration',async()=>{
    const env:any={PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:'staging-fake-test-key-more-than-32-bytes'};
    const r=await phone.request(base+'/events/private/phone-contacts',{},env);
    expect(r.status).toBe(401);
  });
  it('denies unauthenticated contact creation',async()=>{
    const env:any={PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:'staging-fake-test-key-more-than-32-bytes'};
    const r=await phone.request(base+'/events/private/phone-contacts',
      {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},env);
    expect(r.status).toBe(401);
  });
});
