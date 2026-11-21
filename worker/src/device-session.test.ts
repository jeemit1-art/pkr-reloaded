import {describe,it,expect} from 'vitest';
import {issueDeviceSession,renewDeviceSession,revokeDeviceSession} from './device-session';

function fixture(){
  const records=new Map<string,string>();
  const env:any={KV:{
    get:async(key:string)=>records.get(key)||null,
    put:async(key:string,value:string)=>{records.set(key,value);},
    delete:async(key:string)=>{records.delete(key);},
  }};
  return {env,records};
}
describe('approved-device session renewal',()=>{
  it('rotates a device token without changing the approved account identity',async()=>{
    const f=fixture();
    const original=await issueDeviceSession(f.env,'approved-synthetic-member');
    expect(original.refresh_token).toMatch(/^[a-f0-9]{64}$/);
    const next=await renewDeviceSession(f.env,original.refresh_token);
    expect(next?.user_id).toBe('approved-synthetic-member');
    expect(next?.refresh_token).not.toBe(original.refresh_token);
    expect(await renewDeviceSession(f.env,original.refresh_token)).toBeNull();
    const again=await renewDeviceSession(f.env,next!.refresh_token);
    expect(again?.user_id).toBe('approved-synthetic-member');
  });
  it('fails closed for unknown, revoked and malformed credentials',async()=>{
    const f=fixture();
    expect(await renewDeviceSession(f.env,'guess')).toBeNull();
    const current=await issueDeviceSession(f.env,'synthetic-only');
    await revokeDeviceSession(f.env,current.refresh_token);
    expect(await renewDeviceSession(f.env,current.refresh_token)).toBeNull();
    expect(f.records.size).toBe(0);
  });
});
