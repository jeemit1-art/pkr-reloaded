import {describe,it,expect,vi} from 'vitest';
import {archiveAccidentalHistoricalPlayersOnce,TEST_HISTORY_ARCHIVE_DONE} from './archive-test-players';

function fixture(config:{roomCount?:number;test1Count?:number;approved?:boolean;production?:boolean}={}){
  const kvRecords=new Map<string,string>(),writes:string[]=[];
  const kv={
    get:vi.fn(async(key:string)=>kvRecords.get(key)??null),
    put:vi.fn(async(key:string,value:string)=>{kvRecords.set(key,value);writes.push(key);}),
  };
  const reads:string[]=[];
  const db={
    prepare:(sql:string)=>{
      reads.push(sql);
      return {
        all:async()=>{
          if(sql.includes('SELECT e.id FROM events e'))
            return {results:config.roomCount===0?[]:config.roomCount===2?
              [{id:'private-room'},{id:'another-room'}]:[{id:'private-room'}]};
          return {results:[{name:'test',n:1,games:1},
            {name:'test1',n:config.test1Count??1,games:config.test1Count??1}]};
        },
        bind:(id:string)=>{
          expect(id).toBe('private-room');
          return {
            all:async()=>({results:[{name:'test',n:1,games:1},
              {name:'test1',n:config.test1Count??1,games:config.test1Count??1}]}),
            first:async()=>({n:config.approved?1:0}),
          };
        },
      };
    },
  };
  const env:any={PKR_ENV:config.production===false?'staging':'production',KV:kv,DB:db};
  return {env,writes,kvRecords,reads,kv};
}

describe('one-time scheduled owner-authorised roster cleanup',()=>{
 it('archives exact two one-game historical names and never changes D1',async()=>{
   const f=fixture();
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('archived');
   expect(JSON.parse(f.kvRecords.get('room-historical-hidden:v1:private-room')!)).toEqual({names:['test','test1']});
   expect(f.kvRecords.get(TEST_HISTORY_ARCHIVE_DONE)).toBe('done');
   expect(f.writes).toEqual(['room-historical-hidden:v1:private-room',TEST_HISTORY_ARCHIVE_DONE]);
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('already');
   expect(f.writes).toHaveLength(2);
   expect(f.reads.every(s=>!/\b(UPDATE|DELETE|INSERT|REPLACE)\b/i.test(s))).toBe(true);
 });
 it('preserves previously archived unrelated players and host restoration after marker',async()=>{
   const f=fixture();
   f.kvRecords.set('room-historical-hidden:v1:private-room',JSON.stringify({names:['jigsr']}));
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('archived');
   expect(JSON.parse(f.kvRecords.get('room-historical-hidden:v1:private-room')!)).toEqual({names:['jigsr','test','test1']});
   f.kvRecords.set('room-historical-hidden:v1:private-room',JSON.stringify({names:['jigsr']}));
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('already');
   expect(JSON.parse(f.kvRecords.get('room-historical-hidden:v1:private-room')!)).toEqual({names:['jigsr']});
 });
 it('never runs on staging',async()=>{
   const f=fixture({production:false});
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('not_production');
   expect(f.writes).toHaveLength(0);
 });
 it('refuses ambiguous matching rooms and missing historical names',async()=>{
   for(const config of [{roomCount:2},{roomCount:0},{test1Count:2}]){
     const f=fixture(config);
     expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).not.toBe('archived');
     expect(f.writes).toHaveLength(0);
   }
 });
 it('refuses confirmed membership with same names',async()=>{
   const f=fixture({approved:true});
   expect(await archiveAccidentalHistoricalPlayersOnce(f.env)).toBe('approved_member');
   expect(f.writes).toHaveLength(0);
 });
 it('does not mark complete if archived list write fails',async()=>{
   const f=fixture();
   f.kv.put.mockRejectedValueOnce(new Error('synthetic KV write failure'));
   await expect(archiveAccidentalHistoricalPlayersOnce(f.env)).rejects.toThrow('synthetic KV');
   expect(f.kvRecords.has(TEST_HISTORY_ARCHIVE_DONE)).toBe(false);
 });
});

