import {describe,it,expect,vi} from 'vitest';
import {
  validNativeToken,nativePushReady,registerNativeDevice,hasNativeDevice,
  unregisterNativeDevice,sendNativePushToAccount,sendNativePushToEvent
} from './native-push';

function fixture(native:boolean,staging=false){
  const records=new Map<string,string>();
  const db={prepare:()=>({bind:()=>({
    all:async()=>({results:[{user_id:'member1',role:'member'}] as any[]}),
    first:async()=>({allowed:1})
  })})};
  const env={
    PKR_NATIVE_PUSH_ENABLED:native?'1':'0',
    PKR_ENV:staging?'staging':'production',
    KV:{
      get:async(k:string)=>records.get(k)||null,
      put:async(k:string,v:string)=>{records.set(k,v);},
      delete:async(k:string)=>{records.delete(k);},
      list:async({prefix}:{prefix:string})=>({
        keys:[...records.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),
        list_complete:true
      })
    },
    DB:db
  } as any;
  return {records,env};
}
describe('PKR native device notification security',()=>{
  const token='ExpoPushToken[ABCDEFGHIJKLMN1234567890]';
  it('rejects untrusted tokens, URLs and short values',()=>{
    expect(validNativeToken(token)).toBe(true);
    expect(validNativeToken('ExponentPushToken[ABCDEFGHIJKLMN1234567890]')).toBe(true);
    expect(validNativeToken('https://exp.host/?token=x')).toBe(false);
    expect(validNativeToken('ExpoPushToken[abc]')).toBe(false);
    expect(validNativeToken('')).toBe(false);
    expect(validNativeToken(null)).toBe(false);
  });
  it('never accepts native push in staging or while the gate is closed',async()=>{
    expect(nativePushReady(fixture(true,true).env)).toBe(false);
    expect(nativePushReady(fixture(false).env)).toBe(false);
    await expect(registerNativeDevice(fixture(false).env,'room','member1',token,'ios'))
      .rejects.toThrow('not configured');
    expect(await sendNativePushToEvent(fixture(false).env,'room',{
      title:'Private',body:'Test'
    })).toBe(0);
  });
  it('registers only per room/member/device and can opt out',async()=>{
    const {env,records}=fixture(true);
    await registerNativeDevice(env,'room1','member1',token,'ios');
    expect(await hasNativeDevice(env,'room1','member1',token)).toBe(true);
    expect(await hasNativeDevice(env,'room2','member1',token)).toBe(false);
    expect(await hasNativeDevice(env,'room1','member2',token)).toBe(false);
    expect([...records.keys()].join('')).not.toContain(token);
    await unregisterNativeDevice(env,'room1','member1',token);
    expect(await hasNativeDevice(env,'room1','member1',token)).toBe(false);
  });
  it('does not contact the push provider for an account without a registered device',async()=>{
    const {env}=fixture(true);
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    try{
      expect(await sendNativePushToAccount(env,'room1','member1',{
        title:'Private',body:'Financial update'
      })).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    }finally{fetchSpy.mockRestore();}
  });
  it('does not send notifications to former members',async()=>{
    const {env}=fixture(true);
    const fetchSpy=vi.spyOn(globalThis,'fetch');
    try{
      await registerNativeDevice(env,'room1','former',token,'ios');
      expect(await sendNativePushToAccount(env,'room1','former',{
        title:'Private',body:'Financial update'
      })).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    }finally{fetchSpy.mockRestore();}
  });
});
