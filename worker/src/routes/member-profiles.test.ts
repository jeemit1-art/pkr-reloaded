import {describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';

vi.mock('../middleware',()=>({
  authMiddleware:async (c:any,next:any)=>{c.set('userId',c.req.header('X-Test-User')||'viewer');await next();},
  requireEventRole:async (c:any,eventId:string,minRole:string)=>{
    if(eventId!=='room-one')return false;
    const memberRole:Record<string,string>={host:'host',member:'member',viewer:'member'};
    const rank:Record<string,number>={member:1,cohost:2,host:3};
    return (rank[memberRole[c.get('userId')]]||0)>=(rank[minRole]||0);
  },
}));
import profiles from './member-profiles';

type Profile={
  event_id:string;profile_key:string;screen_name:string|null;avatar_data:string|null;
  avatar_emoji:string|null;phone:string|null;preferred_contact:string;
  private_notes:string|null;updated_at:number;
};

function setup(){
  const dbRows=new Map<string,Profile>();
  dbRows.set('room-one:member:member',{
    event_id:'room-one',profile_key:'member:member',screen_name:'Pocket Rocket',avatar_data:null,avatar_emoji:'♠️',
    phone:'+61412345678',preferred_contact:'whatsapp',private_notes:'Only host sees this',updated_at:1,
  });
  const db={
    prepare(sql:string){
      let params:any[]=[];
      const stmt={
        bind(...values:any[]){params=values;return stmt;},
        async first(){
          if(sql.includes('FROM event_members'))return ['host','member','viewer'].includes(params[1])?{ok:1}:null;
          if(sql.includes('FROM game_players'))return params[1]==='historic player'?{ok:1}:null;
          if(sql.includes('FROM room_player_profiles'))return dbRows.get(params[0]+':'+params[1])||null;
          throw new Error('Unexpected SQL .first: '+sql);
        },
        async all(){
          if(!sql.includes('FROM room_player_profiles'))throw new Error('Unexpected SQL .all: '+sql);
          return {results:[...dbRows.values()].filter(x=>x.event_id===params[0])};
        },
        async run(){
          if(!sql.includes('INSERT INTO room_player_profiles'))throw new Error('Unexpected SQL .run: '+sql);
          const [event_id,profile_key,screen_name,avatar_data,avatar_emoji,phone,preferred_contact,private_notes]=params;
          dbRows.set(event_id+':'+profile_key,{event_id,profile_key,screen_name,avatar_data,avatar_emoji,phone,
            preferred_contact,private_notes,updated_at:2});
          return {success:true};
        },
      };
      return stmt;
    },
  };
  const app=new Hono();
  app.route('/events',profiles);
  const call=async(method:'GET'|'PUT',user:string,body?:unknown)=>{
    const response=await app.request('http://localhost/events/room-one/profiles',{
      method,headers:{'X-Test-User':user,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    },{DB:db} as any);
    return {status:response.status,json:await response.json() as any};
  };
  return {call,dbRows};
}

describe('private room profiles',()=>{
  it('shows nickname/photo to members but never exposes another member mobile or host notes',async()=>{
    const {call}=setup();
    const visitor=await call('GET','viewer');
    expect(visitor.status).toBe(200);
    const visible=visitor.json.profiles[0];
    expect(visible.screen_name).toBe('Pocket Rocket');
    expect(visible.avatar_emoji).toBe('♠️');
    expect(visible.phone).toBeNull();
    expect(visible.private_notes).toBeNull();
    const self=await call('GET','member');
    expect(self.json.profiles[0].phone).toBe('+61412345678');
    expect(self.json.profiles[0].private_notes).toBeNull();
    const host=await call('GET','host');
    expect(host.json.profiles[0].phone).toBe('+61412345678');
    expect(host.json.profiles[0].private_notes).toBe('Only host sees this');
  });

  it('rejects edits to someone else and allows valid self/host edits',async()=>{
    const {call,dbRows}=setup();
    const body={profile_key:'member:member',screen_name:'New Ace',avatar_data:null,avatar_emoji:'🃏',
      phone:'+61 412 345 678',preferred_contact:'whatsapp',private_notes:'Do not overwrite'};
    expect((await call('PUT','viewer',body)).status).toBe(403);
    expect((await call('PUT','member',body)).status).toBe(200);
    expect(dbRows.get('room-one:member:member')?.phone).toBe('+61412345678');
    expect(dbRows.get('room-one:member:member')?.private_notes).toBe('Only host sees this');
    expect((await call('PUT','host',{...body,screen_name:'Ace of Spades',private_notes:'New host note'})).status).toBe(200);
    expect(dbRows.get('room-one:member:member')?.private_notes).toBe('New host note');
  });

  it('does not allow arbitrary historical aliases or unsafe image content',async()=>{
    const {call}=setup();
    const base={profile_key:'history:historic player',screen_name:'The Champ',avatar_data:null,
      avatar_emoji:'👑',phone:null,preferred_contact:'none',private_notes:null};
    expect((await call('PUT','host',base)).status).toBe(200);
    expect((await call('PUT','member',base)).status).toBe(403);
    expect((await call('PUT','host',{...base,profile_key:'history:not in room'})).status).toBe(404);
    expect((await call('PUT','host',{...base,avatar_data:'data:image/svg+xml;base64,AAAA'})).status).toBe(400);
    expect((await call('PUT','host',{...base,screen_name:'a'})).status).toBe(400);
    expect((await call('PUT','host',{...base,phone:'123'})).status).toBe(400);
    expect((await call('PUT','host',{...base,profile_key:'history:../escape'})).status).toBe(400);
  });
});
