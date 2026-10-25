import {afterEach,describe,expect,it,vi} from 'vitest';
import router from './phone-members';
import {signJWT} from '../jwt';

const base='https://pkrlocal.invalid';
const contactKey='test-only-manual-whatsapp-encryption-secret-123456789';
const jwtKey='test-only-manual-whatsapp-jwt-secret-123456789';

function makeFixture(){
 const state={
   contact:null as null|{id:string;event_id:string;display_name:string;phone_lookup:string;phone_cipher:string;user_id:null},
   invite:null as null|{id:string;event_id:string;contact_id:string;token_hash:string;role:string;expires_at:number},
   changed:0
 };
 const DB={
   prepare(sql:string){
     return {bind(...args:any[]){
       return {
         async first(){
           if(sql.includes('SELECT role FROM event_members'))return {role:'host'};
           if(sql.includes('SELECT id,user_id FROM group_phone_contacts'))
             return state.contact?{id:state.contact.id,user_id:state.contact.user_id}:null;
           if(sql.includes('SELECT name FROM events WHERE id'))return {name:'Friday Poker Club'};
           if(sql.includes('JOIN group_phone_contacts c')&&sql.includes('group_phone_invites i')){
             if(!state.invite||!state.contact)return null;
             return {...state.invite,display_name:state.contact.display_name,
               phone_cipher:state.contact.phone_cipher,event_name:'Friday Poker Club',
               consumed_at:null,sent_count:0,last_sent_at:null,verify_count:0};
           }
           return null;
         },
         async run(){
           if(sql.includes('INSERT INTO group_phone_contacts')){
             state.contact={id:args[0],event_id:args[1],display_name:args[2],
               phone_lookup:args[3],phone_cipher:args[4],user_id:null};
             state.changed++;return {meta:{changes:1}};
           }
           if(sql.includes('DELETE FROM group_phone_invites')){
             state.invite=null;return {meta:{changes:1}};
           }
           if(sql.includes('INSERT INTO group_phone_invites')){
             state.invite={id:args[0],event_id:args[1],contact_id:args[2],
               token_hash:args[3],role:args[4],expires_at:args[5]};
             return {meta:{changes:1}};
           }
           throw Error('Unexpected D1 SQL: '+sql);
         }
       };
     }};
   },
   async batch(statements:any[]){return Promise.all(statements.map(statement=>statement.run()));}
 };
 const env:any={DB,KV:{},FRONTEND_URL:'https://mypkr.app',
   PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:contactKey,JWT_SECRET:jwtKey};
 return {state,env};
}
afterEach(()=>vi.unstubAllGlobals());

describe('host-sent individual WhatsApp invitations, without any messaging API',()=>{
 it('requires a host and opens a personalised chat link without sending messages',async()=>{
   const {env,state}=makeFixture();
   const network=vi.fn(()=>{throw Error('No messaging API requests permitted');});
   vi.stubGlobal('fetch',network);
   const token=await signJWT({sub:'host',email:'host@example.invalid',name:'Host'},jwtKey);
   const input={display_name:'Alex Test',phone:'0412 345 678',role:'member'};
   const data={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)};
   const withoutHost=await router.request(base+'/events/room/phone-contacts',data,env);
   expect(withoutHost.status).toBe(401);
   const result=await router.request(base+'/events/room/phone-contacts',{
     ...data,headers:{...data.headers,Authorization:'Bearer '+token}},env);
   expect(result.status,await result.clone().text()).toBe(201);
   const json=await result.json() as any;
   expect(json.contact.phone).toBe('+61412345678');
   expect(state.contact?.phone_cipher).not.toContain('+61412345678');
   expect(json.invite.url).toMatch(/^https:\/\/mypkr\.app\/phone-invite\/[a-f0-9]{64}$/);
   const chat=new URL(json.whatsapp_url);
   expect(chat.origin).toBe('https://wa.me');
   expect(chat.pathname).toBe('/61412345678');
   const message=chat.searchParams.get('text')||'';
   expect(message).toContain('Hi Alex Test');
   expect(message).toContain(json.invite.url);
   expect(message).toContain('request to join');
   expect(message).not.toMatch(/verification code|verify your mobile number/i);
   expect(network).not.toHaveBeenCalled();
 });
 it('shows only the masked number to someone holding the unexpired invitation link',async()=>{
   const {env}=makeFixture();
   const token=await signJWT({sub:'host',email:'host@example.invalid',name:'Host'},jwtKey);
   const created=await router.request(base+'/events/room/phone-contacts',{
     method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
     body:JSON.stringify({display_name:'Alex Test',phone:'0412345678',role:'member'})
   },env);
   expect(created.status).toBe(201);
   const result=await created.json() as any;
   const preview=await router.request(base+'/phone-invites/'+result.invite.url.split('/').at(-1),{},env);
   expect(preview.status,await preview.clone().text()).toBe(200);
   const data=await preview.json() as any;
   expect(data.event_name).toBe('Friday Poker Club');
   expect(data.masked_phone).toContain('5678');
   expect(JSON.stringify(data)).not.toContain('+61412345678');
   expect(data.approval_required).toBe(true);
   expect(data.delivery).toBe('manual_whatsapp');
 });
 it('does not expose non-existent automated SMS or WhatsApp-API OTP endpoints',async()=>{
   const {env}=makeFixture();
   const start=await router.request(base+'/auth/mobile/start',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:'{"phone":"0412345678"}'
   },env);
   expect(start.status).toBe(404);
   const send=await router.request(base+'/phone-invites/'+'a'.repeat(64)+'/send-code',{
     method:'POST'
   },env);
   expect(send.status).toBe(404);
 });
});
