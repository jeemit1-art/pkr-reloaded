import {describe,expect,it,vi} from 'vitest';

vi.mock('../middleware',async (importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
vi.mock('../push',()=>({
  sendPushToEvent:vi.fn(async()=>{}),
  sendPushToPlayer:vi.fn(async()=>{}),
}));
import games from './games';

type Player={user_id:string;display_name:string;seat_number:number|null;
  buy_ins:number;buy_in_total:number;cashout:number|null;whatsapp:string|null};
type Rsvp={id:string;display_name:string;whatsapp:string|null};
type BoardRsvp={id:string;display_name:string;status:'yes'|'no';seat_number:number|null};
function fixture(options?:{
  existing?:Player[];rsvps?:Rsvp[];capacity?:number;password?:string|null;
  failBatch?:boolean;lateSeatClaim?:boolean;unpaidHost?:boolean;v2Responses?:BoardRsvp[];
}){
  const game={id:'g',event_id:'e',status:'scheduled',
    seats:options?.capacity??3,game_password:options?.password??null};
  const players:Player[]=[...(options?.existing??[]).map(x=>({...x}))];
  const rsvps:Rsvp[]=options?.rsvps??[];
  let batchCount=0;
  const db={
    prepare(sql:string){
      return {
        bind(...args:any[]){
          return {
            sql,args,
            async first():Promise<any>{
              if(sql.includes('FROM games WHERE id=?'))return {...game};
              if(sql.includes('SELECT host_id FROM events WHERE id=?'))return {host_id:'synthetic-host'};
              if(sql.includes('SELECT plan, trial_started_at, plan_expires_at FROM users WHERE id=?'))
                return {plan:options?.unpaidHost?'trial':'pro',trial_started_at:1,plan_expires_at:null};
              if(sql.includes('FROM event_players WHERE event_id=?'))return null;
              return null;
            },
            async all():Promise<any>{
              if(sql.includes('FROM game_rsvp_guests WHERE game_id=?'))
                return {results:(options?.v2Responses||[]).map(r=>({...r}))};
              if(sql.includes('FROM game_rsvps WHERE game_id=?'))
                return {results:rsvps.map(r=>({...r}))};
              if(sql.includes('FROM game_players WHERE game_id=? ORDER BY created_at ASC'))
                return {results:players.map(p=>({...p}))};
              if(sql.includes('FROM game_players WHERE game_id=? ORDER BY seat_number ASC'))
                return {results:players.map(p=>({...p}))};
              return {results:[]};
            },
          };
        },
      };
    },
    async batch(statements:any[]):Promise<any[]>{
      batchCount++;
      if(options?.failBatch)throw Error('Synthetic D1 transaction rollback');
      const snapshot={status:game.status,players:players.map(p=>({...p}))};
      try{
        const results:any[]=[];
        for(const statement of statements){
          const sql=statement.sql.trim();
          const args=statement.args;
          let changes=0;
          if(sql.startsWith('UPDATE games SET status=')){
            if(game.status==='scheduled'){game.status='active';changes=1;}
          } else if(sql.startsWith('UPDATE game_players SET seat_number=')){
            const [seat,gameId,userId,seatGame,seatValue,statusGame]=args;
            const p=players.find(p=>p.user_id===userId);
            if(game.status==='scheduled'&&gameId==='g'&&seatGame==='g'&&statusGame==='g'&&
              seat===seatValue&&p&&p.seat_number===null&&
              !players.some(p=>p.seat_number===seat)){
              p.seat_number=seat;changes=1;
            }
          } else if(sql.startsWith('INSERT INTO game_players')){
            const [gameId,userId,name,whatsapp,wanted,seatGame,checkSeat,wantedAgain,
              statusGame,knownGame,knownUser,knownName]=args;
            if(game.status==='scheduled'&&gameId==='g'&&seatGame==='g'&&statusGame==='g'&&
              knownGame==='g'&&knownUser===userId&&knownName===name&&
              !players.some(p=>p.user_id===userId||p.display_name===name)){
              const seat=wanted!==null&&wanted===checkSeat&&wanted===wantedAgain&&
                !players.some(p=>p.seat_number===wanted)?wanted:null;
              players.push({user_id:userId,display_name:name,seat_number:seat,whatsapp,
                buy_ins:0,buy_in_total:0,cashout:null});
              changes=1;
            }
          }else throw Error('Unexpected statement in synthetic start transaction');
          results.push({meta:{changes}});
          // Model another host taking a seat after the original plan was read.
          // The SQL in the next INSERT must refuse to overwrite this allocation.
          if(options?.lateSeatClaim && results.length===1){
            players.push({user_id:'other',display_name:'Other Host',seat_number:2,
              buy_ins:0,buy_in_total:0,cashout:null,whatsapp:null});
          }
        }
        return results;
      }catch(error){
        game.status=snapshot.status;
        players.splice(0,players.length,...snapshot.players);
        throw error;
      }
    },
  };
  const env:any={DB:db,JWT_SECRET:'staging-test-only',PKR_ENV:'staging',
    PKR_RSVP_V2:options?.v2Responses?'1':undefined};
  return {env,players,game,batchCount:()=>batchCount};
}
function post(password=''):RequestInit{
  return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})};
}
const url='https://fixture.invalid/games/g/start';
const exec:any={waitUntil:(_:Promise<unknown>)=>{}};

describe('transactional game start and RSVP registration',()=>{
  it('blocks unpaid hosts without changing existing scheduled games or players',async()=>{
    const f=fixture({unpaidHost:true,rsvps:[{id:'a',display_name:'Alice',whatsapp:null}]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(402);
    expect(f.game.status).toBe('scheduled');
    expect(f.players).toHaveLength(0);
    expect(f.batchCount()).toBe(0);
  });
  it('uses V2 attendance, honours reserved seats and excludes declined legacy RSVPs',async()=>{
    const f=fixture({capacity:3,
      existing:[{user_id:'host',display_name:'Host',seat_number:1,buy_ins:0,buy_in_total:0,cashout:null,whatsapp:null},
        {user_id:'quick',display_name:'Quick',seat_number:null,buy_ins:0,buy_in_total:0,cashout:null,whatsapp:null}],
      rsvps:[{id:'legacy-out',display_name:'Declined',whatsapp:null},{id:'legacy-guest',display_name:'Guest',whatsapp:null}],
      v2Responses:[{id:'v2-out',display_name:'Declined',status:'no',seat_number:null},
        {id:'v2-guest',display_name:'Guest',status:'yes',seat_number:3}]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(200);
    expect(f.players.find(p=>p.user_id==='quick')?.seat_number).toBe(2);
    expect(f.players.filter(p=>p.display_name==='Guest').map(p=>p.seat_number)).toEqual([3]);
    expect(f.players.some(p=>p.display_name==='Declined')).toBe(false);
    expect(f.players).toHaveLength(3);
  });
  it('preserves manual seats, fills Quick Seat first and leaves overflow unseated',async()=>{
    const f=fixture({capacity:3,existing:[
      {user_id:'host',display_name:'Host',seat_number:1,buy_ins:2,
        buy_in_total:4000,cashout:null,whatsapp:null},
      {user_id:'quick',display_name:'Quick',seat_number:null,buy_ins:0,
        buy_in_total:0,cashout:null,whatsapp:null},
    ],rsvps:[
      {id:'a',display_name:'Alice',whatsapp:null},
      {id:'b',display_name:'Ben',whatsapp:null},
    ]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(200);
    expect(f.game.status).toBe('active');
    expect(f.players.find(p=>p.user_id==='host')).toMatchObject({
      seat_number:1,buy_ins:2,buy_in_total:4000,
    });
    expect(f.players.find(p=>p.user_id==='quick')?.seat_number).toBe(2);
    expect(f.players.find(p=>p.display_name==='Alice')?.seat_number).toBe(3);
    expect(f.players.find(p=>p.display_name==='Ben')?.seat_number).toBeNull();
    expect(await response.json()).toMatchObject({unseated:['Ben']});
    expect(f.batchCount()).toBe(1);
  });

  it('never creates a duplicate player or resets money for an existing RSVP',async()=>{
    const f=fixture({existing:[{user_id:'alex',display_name:'Alex',seat_number:1,
      buy_ins:2,buy_in_total:4000,cashout:null,whatsapp:null}],
      rsvps:[{id:'alex-again',display_name:'Alex',whatsapp:null}]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(200);
    expect(f.players).toHaveLength(1);
    expect(f.players[0].buy_in_total).toBe(4000);
  });

  it('rejects a second start without applying any second batch of mutations',async()=>{
    const f=fixture({rsvps:[{id:'a',display_name:'Alice',whatsapp:null}]});
    expect((await games.request(url,post(),f.env,exec)).status).toBe(200);
    expect((await games.request(url,post(),f.env,exec)).status).toBe(409);
    expect(f.batchCount()).toBe(1);
    expect(f.players).toHaveLength(1);
  });

  it('allows only one of two simultaneous hosts to start and allocate the RSVP list',async()=>{
    const f=fixture({rsvps:[
      {id:'a',display_name:'Alice',whatsapp:null},
      {id:'b',display_name:'Ben',whatsapp:null},
    ]});
    const [first,second]=await Promise.all([
      games.request(url,post(),f.env,exec),
      games.request(url,post(),f.env,exec),
    ]);
    expect([first.status,second.status].sort()).toEqual([200,409]);
    expect(f.game.status).toBe('active');
    expect(f.players.map(p=>p.display_name)).toEqual(['Alice','Ben']);
    expect(new Set(f.players.map(p=>p.seat_number)).size).toBe(2);
  });

  it('cannot start on an incorrect password and never runs the seating transaction',async()=>{
    const f=fixture({password:'synthetic-game-pin'});
    expect((await games.request(url,post('wrong'),f.env,exec)).status).toBe(401);
    expect(f.game.status).toBe('scheduled');
    expect(f.batchCount()).toBe(0);
  });

  it('does not activate a game if the start transaction fails',async()=>{
    const f=fixture({failBatch:true,rsvps:[{id:'a',display_name:'Alice',whatsapp:null}]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(500);
    expect(f.game.status).toBe('scheduled');
    expect(f.players).toHaveLength(0);
  });

  it('does not displace a new occupant if a seat becomes taken after planning',async()=>{
    const f=fixture({lateSeatClaim:true,rsvps:[
      {id:'a',display_name:'Alice',whatsapp:null},
      {id:'b',display_name:'Ben',whatsapp:null},
    ]});
    const response=await games.request(url,post(),f.env,exec);
    expect(response.status).toBe(200);
    expect(f.players.find(p=>p.display_name==='Alice')?.seat_number).toBe(1);
    expect(f.players.find(p=>p.display_name==='Ben')?.seat_number).toBeNull();
    expect(f.players.find(p=>p.display_name==='Other Host')?.seat_number).toBe(2);
  });
});
