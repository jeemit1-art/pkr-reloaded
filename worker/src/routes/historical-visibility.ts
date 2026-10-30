import {Hono} from 'hono';
import type {Env} from '../types';
import {authMiddleware,requireEventRole} from '../middleware';

const visibility=new Hono<{Bindings:Env}>();
export const HIDDEN_PLAYER_KEY_PREFIX='room-historical-hidden:v1:';
export const normaliseHistoricalName=(name:string)=>
  name.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const validName=(s:unknown):s is string=>
  typeof s==='string'&&s.trim().length>0&&s.trim().length<=100&&
  !/[\x00-\x1f\x7f<>\/\\]/.test(s);

export async function archivedHistoricalNames(kv:KVNamespace,roomId:string):Promise<string[]>{
  const stored=await kv.get(HIDDEN_PLAYER_KEY_PREFIX+roomId);
  if(stored===null)return [];
  const data=JSON.parse(stored) as {names?:unknown};
  if(!data||!Array.isArray(data.names)||data.names.length>250||
     !data.names.every(validName))throw new Error('Invalid archived player state.');
  return [...new Set(data.names.map((x:string)=>normaliseHistoricalName(x)))].sort();
}

// Archiving changes only the visible, historical room roster. Settled
// results, accounts, paid statuses, buy-ins and cash-outs remain untouched.
visibility.get('/:id/historical-player-visibility',authMiddleware,async c=>{
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'member'))return c.json({error:'Forbidden'},403);
  try{
    const names=await archivedHistoricalNames(c.env.KV,id);
    c.header('Cache-Control','private, no-store');
    return c.json({hidden_names:names});
  }catch{return c.json({error:'Archived player list unavailable'},503);}
});

visibility.put('/:id/historical-player-visibility',authMiddleware,async c=>{
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Only host can manage historical players'},403);
  const body=await c.req.json().catch(()=>null) as {name?:unknown;hidden?:unknown}|null;
  if(!body||Object.keys(body).sort().join(',')!=='hidden,name'||
     !validName(body.name)||typeof body.hidden!=='boolean')
    return c.json({error:'Specify one historical player and whether to archive them'},400);
  const name=normaliseHistoricalName(body.name);
  try{
    const found=await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM game_players gp JOIN games g ON g.id=gp.game_id '+
      'WHERE g.event_id=? AND LOWER(TRIM(gp.display_name))=?'
    ).bind(id,name).first<{n:number}>();
    if(!found?.n)return c.json({error:'Historical player does not exist in this room'},404);
    const isMember=await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM event_members em JOIN users u ON u.id=em.user_id '+
      'WHERE em.event_id=? AND LOWER(TRIM(u.name))=?'
    ).bind(id,name).first<{n:number}>();
    if(isMember?.n)return c.json({error:'This is an approved room member. Remove their membership separately.'},409);
    const old=await archivedHistoricalNames(c.env.KV,id);
    const updated=new Set(old);
    if(body.hidden)updated.add(name);
    else updated.delete(name);
    if(updated.size>250)return c.json({error:'Archived player limit reached'},400);
    const names=[...updated].sort();
    await c.env.KV.put(HIDDEN_PLAYER_KEY_PREFIX+id,JSON.stringify({names}));
    c.header('Cache-Control','private, no-store');
    return c.json({hidden_names:names});
  }catch{
    return c.json({error:'Unable to update historical player visibility'},503);
  }
});
export default visibility;

