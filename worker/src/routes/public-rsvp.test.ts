import { describe, expect, it } from 'vitest';
import games from './games';

function fixture() {
  const calls:string[]=[];
  const privateNumber='0400-PRIVATE-TEST-ONLY';
  const rv={id:'rsvp',game_id:'game',display_name:'Fictional Alex',whatsapp:privateNumber,status:'yes',created_at:1};
  const game={id:'game',event_id:'event',scheduled_at:123,location:'Test Room',notes:'',seats:6,status:'scheduled'};
  const env:any={
    DB:{
      prepare(sql:string) {
        calls.push(sql);
        return {
          bind(..._params:unknown[]) {
            return {
              async first() {
                if(sql.includes('FROM games WHERE id=?'))return game;
                if(sql.includes('FROM events WHERE id=?'))return {id:'event',name:'Fictional Event'};
                return null;
              },
              async all() {
                if(sql.includes('FROM game_rsvps')) {
                  // If somebody changes a projection back to SELECT *, the
                  // private phone number reappears and tests must fail.
                  if(sql.includes('SELECT *'))return {results:[rv]};
                  return {results:[{id:rv.id,game_id:rv.game_id,display_name:rv.display_name,status:rv.status,created_at:rv.created_at}]};
                }
                if(sql.includes('FROM game_players'))return {results:[]};
                return {results:[]};
              },
              async run(){return {meta:{changes:1}};},
            };
          },
        };
      },
    },
  };
  return {env,calls,privateNumber};
}

describe('public invitation / RSVP privacy',()=>{
  it('never discloses RSVP WhatsApp numbers through a public lobby URL',async()=>{
    const f=fixture();
    const res=await games.request('https://test.invalid/games/game/lobby',{},f.env);
    expect(res.status).toBe(200);
    const data=await res.json() as any;
    expect(data.rsvps).toHaveLength(1);
    expect(data.rsvps[0].display_name).toBe('Fictional Alex');
    expect(data.rsvps[0]).not.toHaveProperty('whatsapp');
    expect(JSON.stringify(data)).not.toContain(f.privateNumber);
    expect(f.calls.filter(s=>s.includes('FROM game_rsvps'))).toEqual([
      expect.stringContaining('SELECT id,game_id,display_name,status,created_at'),
    ]);
  });

  it('does not enumerate other players\' contacts in the public RSVP confirmation',async()=>{
    const f=fixture();
    const res=await games.request('https://test.invalid/games/game/rsvp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({display_name:'Fictional New',status:'yes'}),
    },f.env);
    expect(res.status).toBe(200);
    const data=await res.json() as any;
    expect(data.rsvps).toHaveLength(1);
    expect(data.rsvps[0]).not.toHaveProperty('whatsapp');
    expect(JSON.stringify(data)).not.toContain(f.privateNumber);
  });
});
