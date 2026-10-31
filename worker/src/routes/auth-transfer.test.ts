import {describe,it,expect,vi} from 'vitest';

vi.mock('../middleware',()=>({
  generateId:()=> 'synthetic-id',
  authMiddleware:async(c:any,next:any)=>{
    if(c.req.header('Authorization')!=='Bearer synthetic-signed-in')
      return c.json({error:'Unauthorized'},401);
    c.set('userId','synthetic-member');
    await next();
  },
}));
vi.mock('../jwt',()=>({
  signJWT:async(user:{sub:string})=>'synthetic-token-'+user.sub,
  verifyJWT:async()=>null,
}));
import auth from './auth';

function fixture(){
  const cache=new Map<string,string>();
  const env:any={
    JWT_SECRET:'synthetic-only',
    KV:{
      get:async(k:string)=>cache.get(k)||null,
      put:async(k:string,v:string)=>{cache.set(k,v);},
      delete:async(k:string)=>{cache.delete(k);},
    },
    DB:{prepare:()=>({bind:()=>({
      first:async()=>({id:'synthetic-member',email:'',name:'Synthetic Player'}),
    })})},
  };
  return {env,cache};
}
describe('app installation session transfer',()=>{
  it('cannot issue transfer codes without an existing authenticated account',async()=>{
    const {env}=fixture();
    const response=await auth.request('https://example.invalid/transfer/start',{method:'POST'},env);
    expect(response.status).toBe(401);
  });
  it('issues a five-minute random code and redeems only once for the same account',async()=>{
    const {env,cache}=fixture();
    const started=await auth.request('https://example.invalid/transfer/start',{
      method:'POST',headers:{Authorization:'Bearer synthetic-signed-in'},
    },env);
    expect(started.status).toBe(200);
    const payload=await started.json() as {code:string;expires_in:number};
    expect(payload.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    expect(payload.expires_in).toBe(300);
    expect(started.headers.get('Cache-Control')).toContain('no-store');
    expect([...cache.values()]).not.toContain(payload.code);
    const redeem=(code:string)=>auth.request('https://example.invalid/transfer/redeem',{
      method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.44'},
      body:JSON.stringify({code}),
    },env);
    const first=await redeem(payload.code.slice(0,4)+'-'+payload.code.slice(4));
    expect(first.status).toBe(200);
    expect((await first.json() as any).token).toBe('synthetic-token-synthetic-member');
    const second=await redeem(payload.code);
    expect(second.status).toBe(401);
  });
  it('rejects malformed codes and rate-limits repeated guesses',async()=>{
    const {env}=fixture();
    const endpoint='https://example.invalid/transfer/redeem';
    const send=(code:string)=>auth.request(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.45'},
      body:JSON.stringify({code}),
    },env);
    expect((await send('not-a-code')).status).toBe(400);
    for(let i=0;i<8;i++)
      expect((await send('ABCDEFGHJKLMNPQR')).status).toBe(401);
    expect((await send('ABCDEFGHJKLMNPQR')).status).toBe(429);
  });
});
