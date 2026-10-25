import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkWhatsappOtp,sendWhatsappOtp,whatsappOtpReady} from './whatsapp-otp';

type Row={rate_key:string;window_start:number;attempts:number};
function fixture(){
 const rows=new Map<string,Row>();
 const env:any={
   PKR_CONTACT_KEY:'synthetic-meta-whatsapp-otp-test-only-000000000000',
   META_WHATSAPP_ACCESS_TOKEN:'unit-test-token-do-not-use',
   META_WHATSAPP_PHONE_NUMBER_ID:'123456789012345',
   META_WHATSAPP_AUTH_TEMPLATE:'pkr_login_otp',
   META_WHATSAPP_TEMPLATE_LANGUAGE:'en_US',
   META_WHATSAPP_API_VERSION:'v24.0',
   DB:{
     prepare(sql:string){
       return {bind(...args:any[]){
         const now=()=>Math.floor(Date.now()/1000);
         return {
           async first(){
             if(sql.startsWith('SELECT rate_key,window_start,attempts')){
               const prefix=String(args[0]).slice(0,-1);
               return [...rows.values()].find(x=>x.rate_key.startsWith(prefix))||null;
             }
             return null;
           },
           async run(){
             if(sql.startsWith('DELETE FROM phone_verification_limits WHERE rate_key LIKE')){
               const prefix=String(args[0]).slice(0,-1);let changes=0;
               for(const k of [...rows.keys()])if(k.startsWith(prefix)){rows.delete(k);changes++;}
               return {meta:{changes}};
             }
             if(sql.startsWith('INSERT INTO phone_verification_limits')){
               rows.set(String(args[0]),{rate_key:String(args[0]),window_start:now(),attempts:0});
               return {meta:{changes:1}};
             }
             if(sql.startsWith('UPDATE phone_verification_limits')){
               const r=rows.get(args[0]);
               if(r&&r.attempts<args[1]){r.attempts++;return {meta:{changes:1}};}
               return {meta:{changes:0}};
             }
             if(sql.startsWith('DELETE FROM phone_verification_limits WHERE rate_key=?')){
               const r=rows.get(args[0]),guarded=args.length>1;
               if(r&&(!guarded||(r.attempts<args[1]&&r.window_start>now()-args[2]))){
                 rows.delete(args[0]);return {meta:{changes:1}};
               }
               return {meta:{changes:0}};
             }
             throw Error('Unexpected D1 query: '+sql);
           }
         };
       }};
     },
     async batch(statements:any[]){return Promise.all(statements.map(s=>s.run()));}
   }
 };
 return {env,rows};
}
afterEach(()=>vi.unstubAllGlobals());

function accepted(codes:string[]){
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{
   expect(url).toBe('https://graph.facebook.com/v24.0/123456789012345/messages');
   expect(init.headers.Authorization).toBe('Bearer unit-test-token-do-not-use');
   const template=JSON.parse(init.body);
   expect(template.messaging_product).toBe('whatsapp');
   expect(template.to).toBe('61412345678');
   const code=template.template.components[0].parameters[0].text;
   expect(code).toMatch(/^\d{6}$/);
   expect(template.template.components[1]).toMatchObject({
     type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}],
   });
   codes.push(code);
   return new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]}),{status:200});
 }));
}

describe('Direct WhatsApp Cloud API OTP without Twilio',()=>{
 it('requires Meta credentials and never calls an external provider when missing',async()=>{
   const {env}=fixture();delete env.META_WHATSAPP_ACCESS_TOKEN;
   expect(whatsappOtpReady(env)).toBe(false);
   expect(await sendWhatsappOtp(env,'+61412345678','invite:demo')).toBe(false);
 });
 it('stores only keyed hashes in D1 and validates the code once for the correct scope',async()=>{
   const {env,rows}=fixture(),codes:string[]=[];accepted(codes);
   expect(await sendWhatsappOtp(env,'+61412345678','invite:demo')).toBe(true);
   expect(rows.size).toBe(1);
   const stored=[...rows.keys()][0];
   expect(stored).not.toContain('+614');
   expect(stored).toMatch(/^wa-otp:[0-9a-f]{64}:[0-9a-f]{64}$/);
   expect(await checkWhatsappOtp(env,'+61412345678',codes[0],'login:demo')).toBe(false);
   expect(await checkWhatsappOtp(env,'+61412345678',codes[0],'invite:demo')).toBe(true);
   expect(await checkWhatsappOtp(env,'+61412345678',codes[0],'invite:demo')).toBe(false);
 });
 it('invalidates old codes when a new code is sent',async()=>{
   const {env,rows}=fixture(),codes:string[]=[];accepted(codes);
   expect(await sendWhatsappOtp(env,'+61412345678','invite:demo')).toBe(true);
   expect(await sendWhatsappOtp(env,'+61412345678','invite:demo')).toBe(true);
   expect(rows.size).toBe(1);
   if(codes[0]!==codes[1]){
     expect(await checkWhatsappOtp(env,'+61412345678',codes[0],'invite:demo')).toBe(false);
     expect(await checkWhatsappOtp(env,'+61412345678',codes[1],'invite:demo')).toBe(true);
   }
 });
 it('removes an unusable OTP if Meta rejects the send',async()=>{
   const {env,rows}=fixture();
   vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"error":"template not approved"}',{status:400})));
   expect(await sendWhatsappOtp(env,'+61412345678','invite:demo')).toBe(false);
   expect(rows.size).toBe(0);
 });
 it('expires codes and refuses a sixth attempt after five incorrect codes',async()=>{
   const {env,rows}=fixture(),codes:string[]=[];accepted(codes);
   const mobile='+61412345678',scope='login:abcdefgh';
   expect(await sendWhatsappOtp(env,mobile,scope)).toBe(true);
   const wrong=codes[0]==='000000'?'111111':'000000';
   for(let i=0;i<5;i++)expect(await checkWhatsappOtp(env,mobile,wrong,scope)).toBe(false);
   expect([...rows.values()][0].attempts).toBe(5);
   expect(await checkWhatsappOtp(env,mobile,codes[0],scope)).toBe(false);
   [...rows.values()][0].window_start-=601;
   expect(await checkWhatsappOtp(env,mobile,codes[0],scope)).toBe(false);
 });
});
